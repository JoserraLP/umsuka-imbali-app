import { createClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────

export interface InstrumentAssignee {
  id: string;
  firstName: string;
  lastName: string;
}

export interface InstrumentItem {
  id: string;
  name: string;
  category: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  /** The currently active responsable, or null when unassigned. */
  currentAssignee: InstrumentAssignee | null;
}

export interface AssignmentRecord {
  id: string;
  instrumentId: string;
  userId: string;
  assignedAt: string;
  unassignedAt: string | null;
  firstName: string;
  lastName: string;
}

export interface AssignableMember {
  id: string;
  firstName: string;
  lastName: string;
}

// ── Queries ───────────────────────────────────────────

/**
 * Returns the instrument inventory, ordered by name. Active assignments
 * are resolved with a single extra query per aspect (no N+1): first the
 * active assignment rows, then the responsable profiles — mirroring the
 * getEventComments merge pattern.
 *
 * By default inactive instruments are hidden (they are not assignable);
 * management listings pass `includeInactive: true` to show them.
 */
export async function getInstruments(
  options: { includeInactive?: boolean } = {},
): Promise<InstrumentItem[]> {
  const supabase = await createClient();

  let query = supabase
    .from("instruments")
    .select("id, name, category, description, is_active, created_at, updated_at");

  if (!options.includeInactive) {
    query = query.eq("is_active", true);
  }

  const { data, error } = await query.order("name", { ascending: true });

  if (error) {
    throw new Error(`Error al obtener instrumentos: ${error.message}`);
  }

  const rows = data ?? [];
  const assigneesById = await resolveActiveAssignees(
    supabase,
    rows.map((row) => row.id),
  );

  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    category: row.category ?? null,
    description: row.description ?? null,
    isActive: row.is_active,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    currentAssignee: assigneesById.get(row.id) ?? null,
  }));
}

/**
 * Returns a single instrument by id with its current responsable, or
 * null when it doesn't exist.
 */
export async function getInstrumentById(
  id: string,
): Promise<InstrumentItem | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("instruments")
    .select("id, name, category, description, is_active, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al obtener el instrumento: ${error.message}`);
  }

  if (!data) return null;

  const assigneesById = await resolveActiveAssignees(supabase, [data.id]);

  return {
    id: data.id,
    name: data.name,
    category: data.category ?? null,
    description: data.description ?? null,
    isActive: data.is_active,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
    currentAssignee: assigneesById.get(data.id) ?? null,
  };
}

/**
 * Full assignment history of an instrument, newest first, enriched with
 * the responsable's display name (merge done in JS — single extra
 * profiles query, no N+1; pattern of getEventComments).
 */
export async function getAssignments(
  instrumentId: string,
): Promise<AssignmentRecord[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("instrument_assignments")
    .select("id, instrument_id, user_id, assigned_at, unassigned_at")
    .eq("instrument_id", instrumentId)
    .order("assigned_at", { ascending: false });

  if (error) {
    throw new Error(
      `Error al obtener el historial de responsables: ${error.message}`,
    );
  }

  const userIds = [...new Set((data ?? []).map((row) => row.user_id))];
  const profilesById = new Map<string, { first_name: string; last_name: string }>();

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", userIds);

    if (profilesError) {
      throw new Error(
        `Error al obtener los perfiles de responsables: ${profilesError.message}`,
      );
    }

    for (const profile of profiles ?? []) {
      profilesById.set(profile.id, {
        first_name: profile.first_name,
        last_name: profile.last_name,
      });
    }
  }

  return (data ?? []).map((row) => {
    const member = profilesById.get(row.user_id);
    return {
      id: row.id,
      instrumentId: row.instrument_id,
      userId: row.user_id,
      assignedAt: row.assigned_at,
      unassignedAt: row.unassigned_at,
      firstName: member?.first_name ?? "Miembro",
      lastName: member?.last_name ?? "",
    };
  });
}

/**
 * Members available to become an instrument responsable: profiles with
 * is_active = true and status = 'active', not soft-deleted, ordered by
 * first name (pattern of `getAvailableMembers` in shifts/queries.ts).
 */
export async function getAssignableMembers(): Promise<AssignableMember[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .eq("is_active", true)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("first_name", { ascending: true });

  if (error) {
    throw new Error(`Error al obtener miembros asignables: ${error.message}`);
  }

  return (data ?? []).map((profile) => ({
    id: profile.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
  }));
}

// ── Shared resolution helper ──────────────────────────

/**
 * Resolves the active responsable per instrument id in two batched
 * queries (assignments + profiles), returning a Map instrumentId →
 * assignee. Used by both list and detail queries to avoid N+1.
 */
async function resolveActiveAssignees(
  supabase: Awaited<ReturnType<typeof createClient>>,
  instrumentIds: string[],
): Promise<Map<string, InstrumentAssignee>> {
  const assigneesById = new Map<string, InstrumentAssignee>();
  const uniqueIds = [...new Set(instrumentIds)];

  if (uniqueIds.length === 0) return assigneesById;

  const { data: assignments, error: assignmentsError } = await supabase
    .from("instrument_assignments")
    .select("instrument_id, user_id")
    .in("instrument_id", uniqueIds)
    .is("unassigned_at", null);

  if (assignmentsError) {
    throw new Error(
      `Error al obtener las asignaciones activas: ${assignmentsError.message}`,
    );
  }

  const userIds = [...new Set((assignments ?? []).map((row) => row.user_id))];
  const profilesById = new Map<string, { first_name: string; last_name: string }>();

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", userIds);

    if (profilesError) {
      throw new Error(
        `Error al obtener los perfiles de responsables: ${profilesError.message}`,
      );
    }

    for (const profile of profiles ?? []) {
      profilesById.set(profile.id, {
        first_name: profile.first_name,
        last_name: profile.last_name,
      });
    }
  }

  for (const assignment of assignments ?? []) {
    const member = profilesById.get(assignment.user_id);
    assigneesById.set(assignment.instrument_id, {
      id: assignment.user_id,
      firstName: member?.first_name ?? "Miembro",
      lastName: member?.last_name ?? "",
    });
  }

  return assigneesById;
}