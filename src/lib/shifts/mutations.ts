import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { requireManagement } from "@/lib/auth/permissions";
import {
  createShiftSchema,
  updateShiftSchema,
  deleteShiftSchema,
  type CreateShiftInput,
  type UpdateShiftInput,
  type DeleteShiftInput,
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

