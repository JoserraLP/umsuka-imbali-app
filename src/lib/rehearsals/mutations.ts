import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import type { AuthenticatedProfile } from "@/types/auth";
import type { RehearsalSession } from "@/types/database.types";
import {
  markRehearsalAttendanceSchema,
  markMultipleRehearsalAttendanceSchema,
  clearRehearsalSessionSchema,
  type MarkRehearsalAttendanceInput,
  type MarkMultipleRehearsalAttendanceInput,
  type ClearRehearsalSessionInput,
} from "@/lib/rehearsals/schema";

export interface RehearsalMutationResult {
  success: boolean;
  error?: string;
}

const SESSION_ONLY_ERROR = "La asistencia por sesiones solo aplica a eventos de tipo ensayo.";
const EVENT_NOT_FOUND_ERROR = "Evento no encontrado.";

// ── Authorization helpers ─────────────────────────────

/**
 * Asserts the current user holds a management role. Returns the
 * authenticated profile on success, or an error result otherwise (no DB
 * writes are performed in that case).
 * Pattern: src/lib/instruments/mutations.ts.
 */
async function requireManagementGuard(
  errorMessage: string,
): Promise<AuthenticatedProfile | RehearsalMutationResult> {
  const actor = await requireAuthenticatedProfile();

  if (!isManagementRole(actor.role)) {
    return { success: false, error: errorMessage };
  }

  return actor;
}

function parseError(errors: { issues: { message: string }[] }): RehearsalMutationResult {
  return {
    success: false,
    error: errors.issues.map((issue) => issue.message).join(", "),
  };
}

/**
 * Fetches the target event and verifies it is a rehearsal with the
 * requested session enabled (defense layer 2 — the RLS write policy and
 * DB constraints remain the last line of defense). Fail-closed: any
 * fetch error aborts the mutation.
 */
async function fetchRehearsalEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  eventId: string,
): Promise<
  | { ok: true; morningSession: boolean; afternoonSession: boolean }
  | { ok: false; error: string }
> {
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("event_type, morning_session, afternoon_session")
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    return { ok: false, error: eventError.message };
  }

  if (!event) {
    return { ok: false, error: EVENT_NOT_FOUND_ERROR };
  }

  if (event.event_type !== "rehearsal") {
    return { ok: false, error: SESSION_ONLY_ERROR };
  }

  return {
    ok: true,
    morningSession: event.morning_session ?? false,
    afternoonSession: event.afternoon_session ?? false,
  };
}

function assertSessionEnabled(
  sessions: { morningSession: boolean; afternoonSession: boolean },
  session: RehearsalSession,
): string | null {
  if (session === "morning" && !sessions.morningSession) {
    return "Este ensayo no tiene sesión de mañana.";
  }
  if (session === "afternoon" && !sessions.afternoonSession) {
    return "Este ensayo no tiene sesión de tarde.";
  }
  return null;
}

// ── Mutations ─────────────────────────────────────────

/**
 * Marks (or updates) per-session attendance for one member at one
 * rehearsal. Uses upsert against the (event_id, user_id, session)
 * unique constraint. marked_by is always stamped server-side from the
 * authenticated actor. Only management can do this.
 */
export async function markRehearsalAttendance(
  input: MarkRehearsalAttendanceInput,
): Promise<RehearsalMutationResult> {
  const parsed = markRehearsalAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard(
    "Solo la directiva puede registrar asistencia a ensayos.",
  );
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const eventCheck = await fetchRehearsalEvent(supabase, parsed.data.eventId);
  if (!eventCheck.ok) {
    return { success: false, error: eventCheck.error };
  }

  const sessionError = assertSessionEnabled(eventCheck, parsed.data.session);
  if (sessionError) {
    return { success: false, error: sessionError };
  }

  const { error } = await supabase.from("rehearsal_attendance").upsert(
    {
      event_id: parsed.data.eventId,
      user_id: parsed.data.userId,
      session: parsed.data.session,
      attended: parsed.data.attended,
      marked_by: authResult.id,
    },
    { onConflict: "event_id,user_id,session" },
  );

  if (error) {
    if (error.code === "23505") {
      // Concurrent duplicate insert raced past the unique constraint:
      // treat as success-equivalent retry hint instead of raw error.
      return {
        success: false,
        error: "Ya existe un registro de asistencia para esa sesión.",
      };
    }
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Marks per-session attendance for multiple members at once. The
 * rehearsal event is validated once up front; each record is then
 * upserted individually (Supabase JS does not support batch upsert
 * with conflict targeting). Only management can do this.
 */
export async function markMultipleRehearsalAttendance(
  input: MarkMultipleRehearsalAttendanceInput,
): Promise<RehearsalMutationResult> {
  const parsed = markMultipleRehearsalAttendanceSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard(
    "Solo la directiva puede registrar asistencia a ensayos.",
  );
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const firstEventId = parsed.data.records[0]!.eventId;
  const eventCheck = await fetchRehearsalEvent(supabase, firstEventId);
  if (!eventCheck.ok) {
    return { success: false, error: eventCheck.error };
  }

  for (const record of parsed.data.records) {
    if (record.eventId !== firstEventId) {
      return {
        success: false,
        error: "Todos los registros deben pertenecer al mismo ensayo.",
      };
    }

    const sessionError = assertSessionEnabled(eventCheck, record.session);
    if (sessionError) {
      return { success: false, error: sessionError };
    }

    const { error } = await supabase.from("rehearsal_attendance").upsert(
      {
        event_id: record.eventId,
        user_id: record.userId,
        session: record.session,
        attended: record.attended,
        marked_by: authResult.id,
      },
      { onConflict: "event_id,user_id,session" },
    );

    if (error) {
      return {
        success: false,
        error: `Error for user ${record.userId}: ${error.message}`,
      };
    }
  }

  return { success: true };
}

/**
 * Removes every attendance row for one session of one rehearsal
 * ("start over" for that session). Only management can do this.
 */
export async function clearRehearsalSession(
  input: ClearRehearsalSessionInput,
): Promise<RehearsalMutationResult> {
  const parsed = clearRehearsalSessionSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard(
    "Solo la directiva puede gestionar asistencia a ensayos.",
  );
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const eventCheck = await fetchRehearsalEvent(supabase, parsed.data.eventId);
  if (!eventCheck.ok) {
    return { success: false, error: eventCheck.error };
  }

  const sessionError = assertSessionEnabled(eventCheck, parsed.data.session);
  if (sessionError) {
    return { success: false, error: sessionError };
  }

  const { error } = await supabase
    .from("rehearsal_attendance")
    .delete()
    .eq("event_id", parsed.data.eventId)
    .eq("session", parsed.data.session);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
