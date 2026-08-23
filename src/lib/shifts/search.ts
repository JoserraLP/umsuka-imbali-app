import { z } from "zod";
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

export type ShiftMemberSearchInput = z.infer<typeof shiftMemberSearchSchema>;

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
