import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/permissions";
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
function assertCanManageWorkgroup(
  workgroup: ActiveWorkgroup,
  actor: AuthenticatedProfile,
): void {
  if (actor.role === "super_admin") {
    return;
  }

  if (!actor.isWorkgroupLead) {
    throw new AuthorizationError(
      "Solo los responsables de grupo pueden marcar asistencia.",
    );
  }

  if (actor.workgroup !== workgroup) {
    throw new AuthorizationError(
      "No puedes marcar asistencia para un grupo que no es el tuyo.",
    );
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

  const { error } = await supabase.from("workgroup_attendance").upsert(
    {
      shift_id: parsed.data.shiftId,
      user_id: parsed.data.userId,
      workgroup: parsed.data.workgroup,
      attended: parsed.data.attended,
      marked_by: actor.id,
    },
    { onConflict: "shift_id, user_id, workgroup" },
  );

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Updates an existing workgroup attendance record by its primary key.
 * Fetches the record first to verify the actor has authority over the
 * workgroup.
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

  const { error } = await supabase
    .from("workgroup_attendance")
    .update({
      attended: parsed.data.attended,
      marked_by: actor.id,
    })
    .eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
