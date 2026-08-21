import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { requireManagement, AuthorizationError } from "@/lib/auth/permissions";
import { REHEARSAL_SESSIONS_UNAVAILABLE_MESSAGE } from "@/lib/events/policy";
import {
  markAttendanceSchema,
  markMultipleAttendanceSchema,
  updateAttendanceSchema,
  deleteAttendanceSchema,
  type MarkAttendanceInput,
  type MarkMultipleAttendanceInput,
  type UpdateAttendanceInput,
  type DeleteAttendanceInput,
} from "@/lib/attendance/schema";
import type { AuthenticatedProfile } from "@/types/auth";

export interface MutationResult {
  success: boolean;
  error?: string;
}

/**
 * Sprint 27: rehearsal events use the per-session flow instead of this
 * generic table. Returns REHEARSAL_SESSIONS_UNAVAILABLE_MESSAGE when the
 * event is a rehearsal, "Evento no encontrado." when the event does not
 * exist (fail closed), or `null` when generic attendance is allowed.
 */
async function rejectRehearsalEvent(eventId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("event_type")
    .eq("id", eventId)
    .maybeSingle();

  if (!data) {
    return "Evento no encontrado.";
  }
  if (data.event_type === "rehearsal") {
    return REHEARSAL_SESSIONS_UNAVAILABLE_MESSAGE;
  }
  return null;
}

/**
 * Resolves the current authenticated profile and enforces the
 * management-role gate. Returns the profile on success, or
 * a MutationResult describing the authorization failure.
 */
async function assertCanManageAttendance(): Promise<AuthenticatedProfile | MutationResult> {
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
 * Marks (or updates) attendance for a single member at an event.
 * Uses upsert with the (event_id, user_id) unique constraint.
 */
export async function markAttendance(input: MarkAttendanceInput): Promise<MutationResult> {
  const parsed = markAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const actorOrError = await assertCanManageAttendance();
  if ("success" in actorOrError) {
    return actorOrError;
  }

  const rehearsalError = await rejectRehearsalEvent(parsed.data.eventId);
  if (rehearsalError !== null) {
    return { success: false, error: rehearsalError };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("attendance").upsert(
    {
      event_id: parsed.data.eventId,
      user_id: parsed.data.userId,
      attended: parsed.data.attended,
    },
    { onConflict: "event_id, user_id" },
  );

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Marks attendance for multiple members at once. Each record is
 * upserted individually (Supabase JS client does not support batch
 * upsert with conflict targeting).
 */
export async function markMultipleAttendance(
  input: MarkMultipleAttendanceInput,
): Promise<MutationResult> {
  const parsed = markMultipleAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const actorOrError = await assertCanManageAttendance();
  if ("success" in actorOrError) {
    return actorOrError;
  }

  const rehearsalError = await rejectRehearsalEvent(parsed.data.records[0]!.eventId);
  if (rehearsalError !== null) {
    return { success: false, error: rehearsalError };
  }

  const supabase = await createClient();

  for (const record of parsed.data.records) {
    if (record.eventId !== parsed.data.records[0]!.eventId) {
      return {
        success: false,
        error: "Todos los registros deben pertenecer al mismo evento.",
      };
    }

    const { error } = await supabase.from("attendance").upsert(
      {
        event_id: record.eventId,
        user_id: record.userId,
        attended: record.attended,
      },
      { onConflict: "event_id, user_id" },
    );

    if (error) {
      return { success: false, error: `Error for user ${record.userId}: ${error.message}` };
    }
  }

  return { success: true };
}

/**
 * Updates an existing attendance record by its primary key.
 */
export async function updateAttendance(input: UpdateAttendanceInput): Promise<MutationResult> {
  const parsed = updateAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const actorOrError = await assertCanManageAttendance();
  if ("success" in actorOrError) {
    return actorOrError;
  }

  const supabase = await createClient();

  // Defense-in-depth (Sprint 27): resolve the record's event first so
  // rehearsal rows can never be mutated through this generic path.
  const { data: record } = await supabase
    .from("attendance")
    .select("event_id")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (!record?.event_id) {
    return { success: false, error: "Registro de asistencia no encontrado." };
  }

  const rehearsalError = await rejectRehearsalEvent(record.event_id);
  if (rehearsalError !== null) {
    return { success: false, error: rehearsalError };
  }

  const { error } = await supabase
    .from("attendance")
    .update({ attended: parsed.data.attended })
    .eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Deletes an attendance record by its primary key.
 */
export async function deleteAttendance(input: DeleteAttendanceInput): Promise<MutationResult> {
  const parsed = deleteAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const actorOrError = await assertCanManageAttendance();
  if ("success" in actorOrError) {
    return actorOrError;
  }

  const supabase = await createClient();

  // Defense-in-depth (Sprint 27): resolve the record's event first so
  // rehearsal rows can never be deleted through this generic path.
  const { data: record } = await supabase
    .from("attendance")
    .select("event_id")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (!record?.event_id) {
    return { success: false, error: "Registro de asistencia no encontrado." };
  }

  const rehearsalError = await rejectRehearsalEvent(record.event_id);
  if (rehearsalError !== null) {
    return { success: false, error: rehearsalError };
  }

  const { error } = await supabase.from("attendance").delete().eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
