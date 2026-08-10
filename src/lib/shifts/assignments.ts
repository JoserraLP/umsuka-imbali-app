import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { assignMemberSchema, unassignMemberSchema } from "@/lib/shifts/schema";
import { checkShiftConflicts, type AssignmentWithUser } from "@/lib/shifts/queries";
import type { Workgroup, AppRole } from "@/types/database.types";

export interface AssignmentResult {
  success: boolean;
  error?: string;
}

export interface MyAssignedShift {
  shiftId: string;
  shiftName: string;
  eventId: string;
  eventTitle: string;
  eventDate: string | null;
  startTime: string;
  endTime: string;
  assignedAt: string;
}

// ──────────────────────────────────────────────────────
// Pure authorization helper (unit-testable, mirrors RLS)
// ──────────────────────────────────────────────────────

export interface ShiftAuthContext {
  eventId: string | null;
  workgroup: Workgroup | null;
}

export interface EventAuthContext {
  eventType: string;
  createdBy: string | null;
}

export interface ActorAuthContext {
  id: string;
  role: AppRole;
  isWorkgroupLead: boolean;
  workgroup: Workgroup;
}

/**
 * Pure rule mirroring the `shift_assignments_insert/delete` RLS policies:
 * a workgroup lead may only assign members to shifts on work_shift events
 * they created, whose workgroup filter (if any) matches their own group.
 * Management is always allowed.
 */
export function canAssignToShift(
  actor: ActorAuthContext,
  shift: ShiftAuthContext | null,
  event: EventAuthContext | null,
): boolean {
  if (isManagementRole(actor.role)) return true;
  if (!actor.isWorkgroupLead || !shift || !event) return false;

  if (event.eventType !== "work_shift") return false;
  if (event.createdBy !== actor.id) return false;
  if (shift.workgroup === null) return true;
  return shift.workgroup === actor.workgroup;
}

// ──────────────────────────────────────────────────────
// Authorization (server-side)
// ──────────────────────────────────────────────────────

async function assertCanAssign(shiftId: string): Promise<AssignmentResult | void> {
  const actor = await requireAuthenticatedProfile();
  const supabase = await createClient();

  const { data: shift, error: shiftError } = await supabase
    .from("shifts")
    .select("event_id, workgroup")
    .eq("id", shiftId)
    .single();

  if (shiftError || !shift) {
    return { success: false, error: "Turno no encontrado." };
  }

  let event: EventAuthContext | null = null;
  if (shift.event_id) {
    const { data } = await supabase
      .from("events")
      .select("event_type, created_by")
      .eq("id", shift.event_id)
      .single();
    event = data ? { eventType: data.event_type, createdBy: data.created_by } : null;
  }

  if (!canAssignToShift(actor, { eventId: shift.event_id, workgroup: shift.workgroup }, event)) {
    return {
      success: false,
      error:
        "No tienes permisos para asignar miembros a este turno. Solo el responsable del grupo puede asignar a los turnos de su grupo.",
    };
  }
}

// ──────────────────────────────────────────────────────
// Queries
// ──────────────────────────────────────────────────────

/**
 * Returns all assignments for a shift, enriched with the assigned
 * members' profile names (two-query + in-memory-join pattern).
 */
export async function getShiftAssignments(shiftId: string): Promise<AssignmentWithUser[]> {
  const supabase = await createClient();

  const { data: assignments, error } = await supabase
    .from("shift_assignments")
    .select("id, shift_id, user_id, created_at")
    .eq("shift_id", shiftId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Error al obtener asignaciones del turno: ${error.message}`);
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

  return (assignments ?? []).map((a) => {
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
}

/**
 * Returns all shifts assigned to a specific user, enriched with
 * event details (title, date) and shift times.
 */
export async function getMyAssignedShifts(userId: string): Promise<MyAssignedShift[]> {
  const supabase = await createClient();

  const { data: assignments, error } = await supabase
    .from("shift_assignments")
    .select("id, shift_id, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Error al obtener asignaciones del usuario: ${error.message}`);
  }

  if (!assignments || assignments.length === 0) return [];

  const shiftIds = [...new Set(assignments.map((a) => a.shift_id).filter(Boolean))] as string[];

  const { data: shifts, error: shiftsError } = await supabase
    .from("shifts")
    .select("id, event_id, name, start_time, end_time, created_at")
    .in("id", shiftIds)
    .order("start_time", { ascending: false });

  if (shiftsError) {
    throw new Error(`Error al obtener turnos: ${shiftsError.message}`);
  }

  const eventIds = [...new Set((shifts ?? []).map((s) => s.event_id).filter(Boolean))] as string[];
  const eventsById = new Map<string, { title: string; event_date: string | null }>();

  if (eventIds.length > 0) {
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("id, title, event_date")
      .in("id", eventIds);

    if (eventsError) {
      throw new Error(`Error al obtener eventos: ${eventsError.message}`);
    }

    for (const event of events ?? []) {
      eventsById.set(event.id, { title: event.title, event_date: event.event_date ?? null });
    }
  }

  const assignmentByShiftId = new Map<string, string>();
  for (const a of assignments ?? []) {
    const shiftId = a.shift_id ?? "";
    if (shiftId && !assignmentByShiftId.has(shiftId)) {
      assignmentByShiftId.set(shiftId, a.id);
    }
  }

  return (shifts ?? []).map((shift) => {
    const event = shift.event_id ? eventsById.get(shift.event_id) : undefined;
    return {
      shiftId: shift.id,
      shiftName: shift.name,
      eventId: shift.event_id ?? "",
      eventTitle: event?.title ?? "Evento desconocido",
      eventDate: event?.event_date ?? null,
      startTime: shift.start_time,
      endTime: shift.end_time,
      assignedAt: assignmentByShiftId.get(shift.id) ?? shift.created_at,
    };
  });
}

// ──────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────

/**
 * Assigns a member to a shift. Checks:
 * 1. The actor is management or the lead of the shift's group/event.
 * 2. The user is not already assigned.
 * 3. The shift has not reached max_assignees.
 * 4. The member's workgroup matches the shift's workgroup filter (if set).
 * 5. No time conflicts with existing assignments.
 */
export async function assignMemberToShift(input: {
  shiftId: string;
  userId: string;
}): Promise<AssignmentResult> {
  const parsed = assignMemberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const authCheck = await assertCanAssign(parsed.data.shiftId);
  if (authCheck && !authCheck.success) {
    return authCheck;
  }

  const actor = await requireAuthenticatedProfile();
  const supabase = await createClient();

  // 1. Get shift details
  const { data: shift, error: shiftError } = await supabase
    .from("shifts")
    .select("id, event_id, name, start_time, end_time, max_assignees, workgroup")
    .eq("id", parsed.data.shiftId)
    .single();

  if (shiftError || !shift) {
    return { success: false, error: "Turno no encontrado." };
  }

  // 2. Check duplicate assignment
  const { data: existingAssignment } = await supabase
    .from("shift_assignments")
    .select("id")
    .eq("shift_id", parsed.data.shiftId)
    .eq("user_id", parsed.data.userId)
    .maybeSingle();

  if (existingAssignment) {
    return { success: false, error: "El miembro ya está asignado a este turno." };
  }

  // 3. Check max_assignees
  if (shift.max_assignees !== null) {
    const { count } = await supabase
      .from("shift_assignments")
      .select("*", { count: "exact", head: true })
      .eq("shift_id", parsed.data.shiftId);

    if (count !== null && count >= shift.max_assignees) {
      return {
        success: false,
        error: `El turno ha alcanzado el máximo de ${shift.max_assignees} asignados.`,
      };
    }
  }

  // 4. Check workgroup filter
  if (shift.workgroup && shift.workgroup !== "ninguno") {
    const { data: profile } = await supabase
      .from("profiles")
      .select("workgroup")
      .eq("id", parsed.data.userId)
      .single();

    if (!profile || profile.workgroup !== shift.workgroup) {
      return {
        success: false,
        error: `El miembro no pertenece al grupo de trabajo requerido: ${shift.workgroup}.`,
      };
    }
  }

  // 5. Check time conflicts
  const conflicts = await checkShiftConflicts(
    parsed.data.userId,
    shift.start_time,
    shift.end_time,
    shift.id, // exclude current shift
  );

  if (conflicts.length > 0) {
    const conflictDescriptions = conflicts
      .map((c) => `"${c.shiftName}" (${formatTimeRange(c.startTime, c.endTime)})`)
      .join(", ");
    return {
      success: false,
      error: `El miembro ya tiene un turno que se superpone: ${conflictDescriptions}.`,
    };
  }

  // 6. Assign
  const { error: insertError } = await supabase.from("shift_assignments").insert({
    shift_id: parsed.data.shiftId,
    user_id: parsed.data.userId,
    created_by: actor.id,
  });

  if (insertError) {
    // Handle unique constraint violation
    if (insertError.code === "23505") {
      return { success: false, error: "El miembro ya está asignado a este turno." };
    }
    return { success: false, error: insertError.message };
  }

  return { success: true };
}

/**
 * Removes a member from a shift. The actor must be management or the
 * lead of the shift's group/event.
 */
export async function unassignMemberFromShift(input: {
  assignmentId: string;
}): Promise<AssignmentResult> {
  const parsed = unassignMemberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const supabase = await createClient();
  const { data: assignment, error: assignmentError } = await supabase
    .from("shift_assignments")
    .select("shift_id")
    .eq("id", parsed.data.assignmentId)
    .single();

  if (assignmentError || !assignment || !assignment.shift_id) {
    return { success: false, error: "Asignación no encontrada." };
  }

  const authCheck = await assertCanAssign(assignment.shift_id);
  if (authCheck && !authCheck.success) {
    return authCheck;
  }

  const { error } = await supabase
    .from("shift_assignments")
    .delete()
    .eq("id", parsed.data.assignmentId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ──────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────

function formatTimeRange(start: string, end: string): string {
  const fmt: Intl.DateTimeFormatOptions = { hour: "2-digit", minute: "2-digit" };
  const startStr = new Date(start).toLocaleTimeString("es-ES", fmt);
  const endStr = new Date(end).toLocaleTimeString("es-ES", fmt);
  return `${startStr} - ${endStr}`;
}
