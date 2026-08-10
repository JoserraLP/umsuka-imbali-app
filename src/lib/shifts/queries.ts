import { createClient } from "@/lib/supabase/server";
import type { Workgroup } from "@/types/database.types";

// ──────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────

export interface AssignmentWithUser {
  id: string;
  shiftId: string;
  userId: string;
  firstName: string;
  lastName: string;
  createdAt: string;
}

export interface ShiftWithAssignments {
  id: string;
  eventId: string;
  name: string;
  startTime: string;
  endTime: string;
  maxAssignees: number | null;
  workgroup: Workgroup | null;
  notes: string | null;
  createdAt: string;
  assignments: AssignmentWithUser[];
}

export interface ShiftConflict {
  shiftId: string;
  shiftName: string;
  startTime: string;
  endTime: string;
}

export interface MemberOption {
  id: string;
  firstName: string;
  lastName: string;
  workgroup: Workgroup;
}

// ──────────────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────────────

/**
 * Returns all shifts for a given event, each enriched with
 * their assignments (with user profile data).
 */
export async function getEventShifts(eventId: string): Promise<ShiftWithAssignments[]> {
  const supabase = await createClient();

  const { data: shifts, error } = await supabase
    .from("shifts")
    .select("id, event_id, name, start_time, end_time, max_assignees, workgroup, notes, created_at")
    .eq("event_id", eventId)
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(`Error al obtener turnos del evento: ${error.message}`);
  }

  if (!shifts || shifts.length === 0) return [];

  const shiftIds = shifts.map((s) => s.id);

  // Fetch all assignments for these shifts
  const { data: assignments, error: assignmentsError } = await supabase
    .from("shift_assignments")
    .select("id, shift_id, user_id, created_at")
    .in("shift_id", shiftIds);

  if (assignmentsError) {
    throw new Error(`Error al obtener asignaciones: ${assignmentsError.message}`);
  }

  // Enrich assignments with profile names
  const userIds = [...new Set((assignments ?? []).map((a) => a.user_id).filter(Boolean))] as string[];
  const profilesById = new Map<string, { first_name: string; last_name: string }>();

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", userIds);

    if (profilesError) {
      throw new Error(`Error al obtener perfiles: ${profilesError.message}`);
    }

    for (const profile of profiles ?? []) {
      profilesById.set(profile.id, {
        first_name: profile.first_name,
        last_name: profile.last_name,
      });
    }
  }

  // Build assignment map
  const assignmentsByShiftId = new Map<string, AssignmentWithUser[]>();
  for (const assignment of assignments ?? []) {
    const shiftId = assignment.shift_id ?? "";
    if (!shiftId) continue;
    const profile = assignment.user_id ? profilesById.get(assignment.user_id) : undefined;
    const entry: AssignmentWithUser = {
      id: assignment.id,
      shiftId,
      userId: assignment.user_id ?? "",
      firstName: profile?.first_name ?? "Miembro",
      lastName: profile?.last_name ?? "",
      createdAt: assignment.created_at,
    };
    const existing = assignmentsByShiftId.get(shiftId) ?? [];
    existing.push(entry);
    assignmentsByShiftId.set(shiftId, existing);
  }

  return shifts.map((shift) => ({
    id: shift.id,
    eventId: shift.event_id ?? eventId,
    name: shift.name,
    startTime: shift.start_time,
    endTime: shift.end_time,
    maxAssignees: shift.max_assignees,
    workgroup: shift.workgroup,
    notes: shift.notes,
    createdAt: shift.created_at,
    assignments: assignmentsByShiftId.get(shift.id) ?? [],
  }));
}

/**
 * Returns a single shift with its assignments.
 */
export async function getShiftById(shiftId: string): Promise<ShiftWithAssignments | null> {
  const supabase = await createClient();

  const { data: shift, error } = await supabase
    .from("shifts")
    .select("id, event_id, name, start_time, end_time, max_assignees, workgroup, notes, created_at")
    .eq("id", shiftId)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al obtener turno: ${error.message}`);
  }

  if (!shift) return null;

  // Fetch assignments
  const { data: assignments, error: assignmentsError } = await supabase
    .from("shift_assignments")
    .select("id, shift_id, user_id, created_at")
    .eq("shift_id", shiftId);

  if (assignmentsError) {
    throw new Error(`Error al obtener asignaciones: ${assignmentsError.message}`);
  }

  const userIds = [...new Set((assignments ?? []).map((a) => a.user_id).filter(Boolean))] as string[];
  const profilesById = new Map<string, { first_name: string; last_name: string }>();

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", userIds);

    if (profilesError) {
      throw new Error(`Error al obtener perfiles: ${profilesError.message}`);
    }

    for (const profile of profiles ?? []) {
      profilesById.set(profile.id, {
        first_name: profile.first_name,
        last_name: profile.last_name,
      });
    }
  }

  const enrichedAssignments: AssignmentWithUser[] = (assignments ?? []).map((a) => {
    const profile = a.user_id ? profilesById.get(a.user_id) : undefined;
    return {
      id: a.id,
      shiftId: a.shift_id ?? shiftId,
      userId: a.user_id ?? "",
      firstName: profile?.first_name ?? "Miembro",
      lastName: profile?.last_name ?? "",
      createdAt: a.created_at,
    };
  });

  return {
    id: shift.id,
    eventId: shift.event_id ?? "",
    name: shift.name,
    startTime: shift.start_time,
    endTime: shift.end_time,
    maxAssignees: shift.max_assignees,
    workgroup: shift.workgroup,
    notes: shift.notes,
    createdAt: shift.created_at,
    assignments: enrichedAssignments,
  };
}

/**
 * Checks for conflicting shifts for a given user within a time range.
 * Two shifts conflict if they overlap in time (start < other_end AND end > other_start).
 * Optionally excludes a specific shift (for update scenarios).
 */
export async function checkShiftConflicts(
  userId: string,
  startTime: string,
  endTime: string,
  excludeShiftId?: string,
): Promise<ShiftConflict[]> {
  const supabase = await createClient();

  let query = supabase
    .from("shift_assignments")
    .select("shift_id, shifts!inner(id, name, start_time, end_time)")
    .eq("user_id", userId)
    .lt("shifts.start_time", endTime)
    .gt("shifts.end_time", startTime);

  if (excludeShiftId) {
    query = query.neq("shifts.id", excludeShiftId);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Error al verificar conflictos de horario: ${error.message}`);
  }

  return ((data as unknown as Array<{ shift_id: string; shifts: { id: string; name: string; start_time: string; end_time: string } }>) ?? [])
    .filter((item) => item.shifts)
    .map((item) => ({
      shiftId: item.shifts.id,
      shiftName: item.shifts.name,
      startTime: item.shifts.start_time,
      endTime: item.shifts.end_time,
    }));
}

/**
 * Returns all active members (profiles with status = 'active')
 * for assignment dropdowns.
 */
export async function getAvailableMembers(): Promise<MemberOption[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, workgroup")
    .eq("status", "active")
    .order("first_name", { ascending: true });

  if (error) {
    throw new Error(`Error al obtener miembros disponibles: ${error.message}`);
  }

  return (data ?? []).map((p) => ({
    id: p.id,
    firstName: p.first_name,
    lastName: p.last_name,
    workgroup: p.workgroup ?? "ninguno",
  }));
}

/**
 * Pure utility function to check if two time intervals overlap.
 * Two intervals [a_start, a_end) and [b_start, b_end) overlap
 * if a_start < b_end AND a_end > b_start.
 */
export function shiftsOverlap(
  a: { startTime: string; endTime: string },
  b: { startTime: string; endTime: string },
): boolean {
  return new Date(a.startTime) < new Date(b.endTime) && new Date(a.endTime) > new Date(b.startTime);
}
