import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/permissions";
import {
  rejectAttendanceOnlyEvent,
  WORKGROUP_ATTENDANCE_UNAVAILABLE_MESSAGE,
} from "@/lib/events/policy";
import {
  markWorkgroupAttendanceSchema,
  updateWorkgroupAttendanceSchema,
  type MarkWorkgroupAttendanceInput,
  type UpdateWorkgroupAttendanceInput,
  type ActiveWorkgroup,
} from "@/lib/workgroups/schema";
import type { AuthenticatedProfile } from "@/types/auth";

export interface MutationResult {
  success: boolean;
  error?: string;
}

/**
 * Application-layer authorization guard: checks that the actor is
 * either a workgroup lead for the given workgroup OR a super_admin.
 */
function assertCanManageWorkgroup(workgroup: ActiveWorkgroup, actor: AuthenticatedProfile): void {
  if (actor.role === "super_admin") {
    return;
  }

  if (!actor.isWorkgroupLead) {
    throw new AuthorizationError("Solo los responsables de grupo pueden marcar asistencia.");
  }

  if (actor.workgroup !== workgroup) {
    throw new AuthorizationError("No puedes marcar asistencia para un grupo que no es el tuyo.");
  }
}

/**
 * Marks (or updates) workgroup attendance for a member on a shift.
 * Uses upsert with the (shift_id, user_id, workgroup) unique constraint.
 */
export async function markWorkgroupAttendance(
  input: MarkWorkgroupAttendanceInput,
): Promise<MutationResult> {
  const parsed = markWorkgroupAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const actor = await requireAuthenticatedProfile();

  try {
    assertCanManageWorkgroup(parsed.data.workgroup, actor);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  const supabase = await createClient();

  const { data: shift } = await supabase
    .from("shifts")
    .select("event_id")
    .eq("id", parsed.data.shiftId)
    .maybeSingle();

  if (!shift) {
    return { success: false, error: "Turno no encontrado." };
  }

  // Meeting/carnival events are attendance-only: workgroup attendance is
  // unavailable for their shifts.
  if (shift.event_id) {
    const eventTypeError = await rejectAttendanceOnlyEvent(
      shift.event_id,
      WORKGROUP_ATTENDANCE_UNAVAILABLE_MESSAGE,
    );
    if (eventTypeError) {
      return { success: false, error: eventTypeError };
    }
  }

  let error;

  if (parsed.data.workgroup === "barra") {
    ({ error } = await supabase.from("workgroup_attendance").upsert(
      {
        shift_id: parsed.data.shiftId,
        user_id: parsed.data.userId,
        workgroup: parsed.data.workgroup,
        attended: parsed.data.attended,
        marked_by: actor.id,
        barra_task: parsed.data.barraTask,
        hours_worked: null,
      },
      { onConflict: "shift_id, user_id, workgroup" },
    ));
  } else {
    ({ error } = await supabase.from("workgroup_attendance").upsert(
      {
        shift_id: parsed.data.shiftId,
        user_id: parsed.data.userId,
        workgroup: parsed.data.workgroup,
        attended: parsed.data.attended,
        marked_by: actor.id,
        hours_worked: parsed.data.hoursWorked,
        barra_task: null,
      },
      { onConflict: "shift_id, user_id, workgroup" },
    ));
  }

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Updates an existing workgroup attendance record by its primary key.
 * Fetches the record first to verify the actor has authority over the
 * workgroup.
 *
 * Note (Sprint 17b): intentionally has NO attendance-only guard — records
 * for meeting/carnival shifts are removed by migration 0048 and the UI
 * only renders this panel for shifts-capable events, so this legacy
 * mutation is unreachable for attendance-only events. The guard lives in
 * markWorkgroupAttendance, which is the entry point that can create new
 * records.
 */
export async function updateWorkgroupAttendance(
  input: UpdateWorkgroupAttendanceInput,
): Promise<MutationResult> {
  const parsed = updateWorkgroupAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const actor = await requireAuthenticatedProfile();
  const supabase = await createClient();

  // Fetch existing record to validate workgroup access
  const { data: existing, error: fetchError } = await supabase
    .from("workgroup_attendance")
    .select("workgroup")
    .eq("id", parsed.data.id)
    .single();

  if (fetchError || !existing) {
    return {
      success: false,
      error: fetchError?.message ?? "Attendance record not found.",
    };
  }

  try {
    assertCanManageWorkgroup(existing.workgroup as ActiveWorkgroup, actor);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  const baseUpdate = {
    attended: parsed.data.attended,
    marked_by: actor.id,
  } as const;

  const { error } = await supabase
    .from("workgroup_attendance")
    .update({
      ...baseUpdate,
      ...(parsed.data.hoursWorked !== undefined ? { hours_worked: parsed.data.hoursWorked } : {}),
      ...(parsed.data.barraTask !== undefined ? { barra_task: parsed.data.barraTask } : {}),
    })
    .eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
