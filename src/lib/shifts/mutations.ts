import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { requireManagement, AuthorizationError } from "@/lib/auth/permissions";
import { checkShiftConflicts } from "@/lib/shifts/queries";
import {
  createShiftSchema,
  updateShiftSchema,
  deleteShiftSchema,
  assignMemberSchema,
  unassignMemberSchema,
  type CreateShiftInput,
  type UpdateShiftInput,
  type DeleteShiftInput,
  type AssignMemberInput,
  type UnassignMemberInput,
} from "@/lib/shifts/schema";

export interface MutationResult {
  success: boolean;
  error?: string;
}

// ──────────────────────────────────────────────────────
// Authorization helpers
// ──────────────────────────────────────────────────────

/**
 * Asserts the current user is authorized to manage shifts.
 * Management roles can manage shifts for any event.
 * Workgroup leads can manage shifts for work_shift events they created.
 */
async function assertCanManageShifts(eventId?: string): Promise<MutationResult | void> {
  const actor = await requireAuthenticatedProfile();

  // Management roles always pass
  try {
    requireManagement(actor.role);
    return; // Allowed
  } catch {
    // Not a management role — check workgroup lead exception
  }

  if (actor.isWorkgroupLead && eventId) {
    const supabase = await createClient();
    const { data: event } = await supabase
      .from("events")
      .select("event_type, created_by")
      .eq("id", eventId)
      .single();

    if (event?.event_type === "work_shift" && event.created_by === actor.id) {
      return; // Allowed
    }
  }

  return { success: false, error: "No tienes permisos para gestionar turnos." };
}

/**
 * Asserts the current user is management (for assign/unassign operations
 * where we don't have a direct event context).
 */
async function assertManagement(): Promise<MutationResult | void> {
  const actor = await requireAuthenticatedProfile();
  try {
    requireManagement(actor.role);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { success: false, error: err.message };
    }
    throw err;
  }
}

// ──────────────────────────────────────────────────────
// Mutations
// ──────────────────────────────────────────────────────

/**
 * Creates a new shift for an event.
 */
export async function createShift(input: CreateShiftInput): Promise<MutationResult> {
  const parsed = createShiftSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const authCheck = await assertCanManageShifts(parsed.data.eventId);
  if (authCheck && "success" in authCheck && !authCheck.success) {
    return authCheck;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("shifts").insert({
    event_id: parsed.data.eventId,
    name: parsed.data.name,
    start_time: parsed.data.startTime,
    end_time: parsed.data.endTime,
    max_assignees: parsed.data.maxAssignees,
    workgroup: parsed.data.workgroup,
    notes: parsed.data.notes,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Updates an existing shift.
 */
export async function updateShift(input: UpdateShiftInput): Promise<MutationResult> {
  const parsed = updateShiftSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const authCheck = await assertCanManageShifts(parsed.data.eventId);
  if (authCheck && "success" in authCheck && !authCheck.success) {
    return authCheck;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("shifts")
    .update({
      name: parsed.data.name,
      start_time: parsed.data.startTime,
      end_time: parsed.data.endTime,
      max_assignees: parsed.data.maxAssignees,
      workgroup: parsed.data.workgroup,
      notes: parsed.data.notes,
    })
    .eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Deletes a shift (cascade removes assignments).
 */
export async function deleteShift(input: DeleteShiftInput): Promise<MutationResult> {
  const parsed = deleteShiftSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  // Get event_id for auth check
  const supabase = await createClient();
  const { data: shift } = await supabase
    .from("shifts")
    .select("event_id")
    .eq("id", parsed.data.id)
    .single();

  if (!shift) {
    return { success: false, error: "Turno no encontrado." };
  }

  const authCheck = await assertCanManageShifts(shift.event_id ?? undefined);
  if (authCheck && "success" in authCheck && !authCheck.success) {
    return authCheck;
  }

  const { error } = await supabase.from("shifts").delete().eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Assigns a member to a shift. Checks:
 * 1. The user is not already assigned.
 * 2. The shift has not reached max_assignees.
 * 3. The member's workgroup matches the shift's workgroup filter (if set).
 * 4. No time conflicts with existing assignments.
 */
export async function assignMember(input: AssignMemberInput): Promise<MutationResult> {
  const parsed = assignMemberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const authCheck = await assertManagement();
  if (authCheck && "success" in authCheck && !authCheck.success) {
    return authCheck;
  }

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
 * Removes a member from a shift.
 */
export async function unassignMember(input: UnassignMemberInput): Promise<MutationResult> {
  const parsed = unassignMemberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const authCheck = await assertManagement();
  if (authCheck && "success" in authCheck && !authCheck.success) {
    return authCheck;
  }

  const supabase = await createClient();
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
