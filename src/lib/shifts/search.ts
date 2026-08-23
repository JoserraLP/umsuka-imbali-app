import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { isManagementRole } from "@/lib/auth/roles";
import { AuthorizationError } from "@/lib/auth/permissions";
import type { AuthenticatedProfile } from "@/types/auth";
import { activeWorkgroupSchema, type ActiveWorkgroup } from "@/lib/workgroups/schema";

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

/** A member assigned to the shift, matched by the search, with attendance state. */
export interface ShiftMemberSearchRow {
  userId: string;
  firstName: string;
  lastName: string;
  workgroup: ActiveWorkgroup;
  /** true = presente; false = ausente; null = sin marcar. */
  attended: boolean | null;
}

/** One paginated page of search results. */
export interface ShiftMemberSearchPage {
  rows: ShiftMemberSearchRow[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ──────────────────────────────────────────────────────
// Schema
// ──────────────────────────────────────────────────────

export const SHIFT_MEMBER_SEARCH_DEFAULT_PAGE = 1;
export const SHIFT_MEMBER_SEARCH_DEFAULT_PAGE_SIZE = 20;
export const SHIFT_MEMBER_SEARCH_MAX_PAGE_SIZE = 50;

/**
 * Page numbers are clamped instead of rejected so an out-of-range page
 * coming from stale client state degrades to a valid one. Non-integers
 * are still rejected (programming errors).
 */
const pageField = z
  .number({ invalid_type_error: "page debe ser un número entero." })
  .int("page debe ser un número entero.")
  .default(SHIFT_MEMBER_SEARCH_DEFAULT_PAGE)
  .transform((value) => Math.max(1, value));

const pageSizeField = z
  .number({ invalid_type_error: "pageSize debe ser un número entero." })
  .int("pageSize debe ser un número entero.")
  .default(SHIFT_MEMBER_SEARCH_DEFAULT_PAGE_SIZE)
  .transform((value) =>
    Math.min(SHIFT_MEMBER_SEARCH_MAX_PAGE_SIZE, Math.max(1, value)),
  );

export const shiftMemberSearchSchema = z.object({
  shiftId: z.string().uuid("shiftId debe ser un UUID válido."),
  query: z
    .string()
    .trim()
    .min(1, "Introduce un nombre o apellido para buscar.")
    .max(100, "La búsqueda no puede superar los 100 caracteres."),
  workgroup: activeWorkgroupSchema.nullish(),
  page: pageField,
  pageSize: pageSizeField,
});

/**
 * Wire format sent by clients: pagination fields are optional because
 * the schema applies defaults/clamps server-side before any query.
 */
export type ShiftMemberSearchInput = z.input<typeof shiftMemberSearchSchema>;

// ──────────────────────────────────────────────────────
// Pure helpers
// ──────────────────────────────────────────────────────

/**
 * Escapes a raw search term so it can be used as a literal inside a
 * Postgres ILIKE pattern. Backslash MUST be escaped first (it is itself
 * the escape character); then `%` and `_` wildcards.
 *
 * Known limitation: accents are matched exactly (ILIKE is not
 * unaccent-aware), so "Jose" will not match "José" and vice versa.
 */
export function escapeIlikePattern(raw: string): string {
  return raw.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Removes characters that would break the PostgREST `.or(...)` filter
 * syntax: a comma inside the ILIKE value would be parsed as a condition
 * separator (→ HTTP 400) and double quotes open/close value quoting.
 * Replaced with spaces so "López, María" still behaves like a term.
 */
function stripPostgrestSeparatorChars(raw: string): string {
  return raw.replace(/[,"]/g, " ");
}

// ──────────────────────────────────────────────────────
// Query
// ──────────────────────────────────────────────────────

const EMPTY_PAGE = (page = SHIFT_MEMBER_SEARCH_DEFAULT_PAGE, pageSize = SHIFT_MEMBER_SEARCH_DEFAULT_PAGE_SIZE): ShiftMemberSearchPage => ({
  rows: [],
  total: 0,
  page,
  pageSize,
  hasMore: false,
});

/**
 * Searches the members ASSIGNED to a shift (shift_assignments ⨝ profiles)
 * by first/last name, optionally filtered by workgroup, with real
 * pagination. Fails closed:
 *
 * 1. Only management roles get unrestricted access.
 * 2. A workgroup lead is ALWAYS scoped to their own group — a requested
 *    workgroup filter is ignored when it differs from their scope
 *    (mirror of page.tsx `leadWorkgroup` handling).
 * 3. Any other role gets an AuthorizationError before any DB access.
 */
export async function searchShiftMembers(
  actor: AuthenticatedProfile,
  input: unknown,
): Promise<ShiftMemberSearchPage> {
  // 1. Fail-closed authorization BEFORE anything else (no Supabase access).
  if (!isManagementRole(actor.role) && !actor.isWorkgroupLead) {
    throw new AuthorizationError(
      "No tienes permisos para buscar miembros en este turno.",
    );
  }

  // 2. Blank query → empty page without touching the DB (the searcher
  //    starts blank). Runs before Zod because the schema requires min(1)
  //    for real searches; the blank state is a valid UI state, not an error.
  const rawQuery =
    typeof input === "object" && input !== null && "query" in input
      ? (input as { query: unknown }).query
      : undefined;
  if (typeof rawQuery === "string" && rawQuery.trim() === "") {
    return EMPTY_PAGE();
  }

  // 3. Validate input before any query is executed (throws ZodError).
  const parsed = shiftMemberSearchSchema.parse(input);

  const supabase = await createClient();

  // Query 1: user ids assigned to this shift (anchored by shift_id index).
  const { data: assignments, error: assignmentsError } = await supabase
    .from("shift_assignments")
    .select("user_id")
    .eq("shift_id", parsed.shiftId);

  if (assignmentsError) {
    throw new Error(
      `Error al obtener asignaciones del turno: ${assignmentsError.message}`,
    );
  }

  const userIds = [
    ...new Set((assignments ?? []).map((a) => a.user_id).filter(Boolean)),
  ] as string[];

  if (userIds.length === 0) {
    return EMPTY_PAGE(parsed.page, parsed.pageSize);
  }

  // Scope resolution: lead scope always wins over the requested filter.
  let workgroupScope: ActiveWorkgroup | null = null;
  if (!isManagementRole(actor.role)) {
    workgroupScope = actor.workgroup as ActiveWorkgroup;
  } else if (parsed.workgroup) {
    workgroupScope = parsed.workgroup;
  }

  const pattern = `%${escapeIlikePattern(stripPostgrestSeparatorChars(parsed.query))}%`;

  // Query 2: profiles of the assigned members matching the text filter,
  // ordered stably and paginated server-side with an exact total count.
  let profileQuery = supabase
    .from("profiles")
    .select("id, first_name, last_name, workgroup", { count: "exact" })
    .in("id", userIds)
    .or(`first_name.ilike.${pattern},last_name.ilike.${pattern}`);

  if (workgroupScope) {
    profileQuery = profileQuery.eq("workgroup", workgroupScope);
  }

  const from = (parsed.page - 1) * parsed.pageSize;
  const to = from + parsed.pageSize - 1;

  const { data: profiles, count, error: profilesError } = await profileQuery
    .order("first_name", { ascending: true })
    .order("last_name", { ascending: true })
    .range(from, to);

  if (profilesError) {
    throw new Error(`Error al buscar miembros del turno: ${profilesError.message}`);
  }

  // Query 3: attendance records for this shift, merged in memory so each
  // row carries its current attended state (null = sin marcar).
  const { data: attendance, error: attendanceError } = await supabase
    .from("workgroup_attendance")
    .select("user_id, attended")
    .eq("shift_id", parsed.shiftId);

  if (attendanceError) {
    throw new Error(`Error al obtener asistencia del turno: ${attendanceError.message}`);
  }

  const attendedByUser = new Map<string, boolean>();
  for (const record of attendance ?? []) {
    if (record.user_id) {
      attendedByUser.set(record.user_id, record.attended === true);
    }
  }

  const rows: ShiftMemberSearchRow[] = (profiles ?? []).map((p) => ({
    userId: p.id,
    firstName: p.first_name,
    lastName: p.last_name,
    workgroup: p.workgroup as ActiveWorkgroup,
    attended: attendedByUser.get(p.id) ?? null,
  }));

  const total = count ?? rows.length;

  return {
    rows,
    total,
    page: parsed.page,
    pageSize: parsed.pageSize,
    hasMore: from + rows.length < total,
  };
}
