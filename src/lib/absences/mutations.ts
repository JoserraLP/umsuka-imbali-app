import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { requireManagement, AuthorizationError } from "@/lib/auth/permissions";
import { rejectAttendanceOnlyEvent, ABSENCES_UNAVAILABLE_MESSAGE } from "@/lib/events/policy";
import {
  requestAbsenceSchema,
  justifyAbsenceSchema,
  deleteAbsenceSchema,
  type RequestAbsenceInput,
  type JustifyAbsenceInput,
  type DeleteAbsenceInput,
} from "@/lib/absences/schema";
import type { AuthenticatedProfile } from "@/types/auth";

export interface MutationResult {
  success: boolean;
  error?: string;
}

/**
 * Resolves the current authenticated profile and enforces the
 * management-role gate. Returns the profile on success, or
 * a MutationResult describing the authorization failure.
 */
async function assertCanManageAbsences(): Promise<AuthenticatedProfile | MutationResult> {
  const actor = await requireAuthenticatedProfile();
  try {
    requireManagement(actor.role);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { success: false, error: err.message };
    }
    throw err;
  }
  return actor;
}

/**
 * Submits an absence request for the currently authenticated user.
 * The `userId` is always taken from the authenticated session (not from
 * client input) to prevent impersonation — RLS enforces the same rule.
 */
export async function requestAbsence(input: RequestAbsenceInput): Promise<MutationResult> {
  const parsed = requestAbsenceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const actor = await requireAuthenticatedProfile();

  // Meeting/carnival events are attendance-only: absences are unavailable.
  const eventTypeError = await rejectAttendanceOnlyEvent(
    parsed.data.eventId,
    ABSENCES_UNAVAILABLE_MESSAGE,
  );
  if (eventTypeError) {
    return { success: false, error: eventTypeError };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("absences").insert({
    user_id: actor.id,
    event_id: parsed.data.eventId,
    reason: parsed.data.reason,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Justifies (approves) or rejects an absence request. Management only.
 */
export async function justifyAbsence(input: JustifyAbsenceInput): Promise<MutationResult> {
  const parsed = justifyAbsenceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const actorOrError = await assertCanManageAbsences();
  if ("success" in actorOrError) {
    return actorOrError;
  }

  const supabase = await createClient();

  // The source of truth is the absence's REAL event (from the DB).
  const { data: absence } = await supabase
    .from("absences")
    .select("event_id")
    .eq("id", parsed.data.absenceId)
    .maybeSingle();

  if (!absence) {
    return { success: false, error: "Ausencia no encontrada." };
  }

  // Meeting/carnival events are attendance-only: absences are unavailable.
  if (absence.event_id) {
    const eventTypeError = await rejectAttendanceOnlyEvent(
      absence.event_id,
      ABSENCES_UNAVAILABLE_MESSAGE,
    );
    if (eventTypeError) {
      return { success: false, error: eventTypeError };
    }
  }

  const { error } = await supabase
    .from("absences")
    .update({ justified: parsed.data.justified })
    .eq("id", parsed.data.absenceId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Deletes an absence record. Management only.
 */
export async function deleteAbsence(input: DeleteAbsenceInput): Promise<MutationResult> {
  const parsed = deleteAbsenceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const actorOrError = await assertCanManageAbsences();
  if ("success" in actorOrError) {
    return actorOrError;
  }

  const supabase = await createClient();

  // The source of truth is the absence's REAL event (from the DB).
  const { data: absence } = await supabase
    .from("absences")
    .select("event_id")
    .eq("id", parsed.data.absenceId)
    .maybeSingle();

  if (!absence) {
    return { success: false, error: "Ausencia no encontrada." };
  }

  // Meeting/carnival events are attendance-only: absences are unavailable.
  if (absence.event_id) {
    const eventTypeError = await rejectAttendanceOnlyEvent(
      absence.event_id,
      ABSENCES_UNAVAILABLE_MESSAGE,
    );
    if (eventTypeError) {
      return { success: false, error: eventTypeError };
    }
  }

  const { error } = await supabase.from("absences").delete().eq("id", parsed.data.absenceId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
