import { z } from "zod";
import type { RehearsalSession } from "@/types/database.types";

/**
 * Canonical rehearsal sessions, in display order. Mirrors the
 * umsuka.rehearsal_session enum created by migration
 * 20260101005800_rehearsal_attendance.sql.
 */
export const REHEARSAL_SESSIONS: readonly RehearsalSession[] = ["morning", "afternoon"] as const;

/** Spanish labels for each rehearsal session. */
export const SESSION_LABELS: Record<RehearsalSession, string> = {
  morning: "Mañana",
  afternoon: "Tarde",
};

export function isRehearsalSession(value: string): value is RehearsalSession {
  return (REHEARSAL_SESSIONS as readonly string[]).includes(value);
}

// ── Schemas ───────────────────────────────────────────

export const markRehearsalAttendanceSchema = z.object({
  eventId: z.string().uuid("El ID del evento debe ser un UUID válido."),
  userId: z.string().uuid("El ID del usuario debe ser un UUID válido."),
  session: z.enum(["morning", "afternoon"], {
    errorMap: () => ({ message: "La sesión debe ser mañana o tarde." }),
  }),
  attended: z.boolean({ required_error: "Debes indicar si asistió.", invalid_type_error: "Debes indicar si asistió." }),
});
export type MarkRehearsalAttendanceInput = z.infer<typeof markRehearsalAttendanceSchema>;

export const markMultipleRehearsalAttendanceSchema = z.object({
  records: z
    .array(markRehearsalAttendanceSchema)
    .min(1, "Se requiere al menos un registro de asistencia al ensayo."),
});
export type MarkMultipleRehearsalAttendanceInput = z.infer<
  typeof markMultipleRehearsalAttendanceSchema
>;

export const clearRehearsalSessionSchema = z.object({
  eventId: z.string().uuid("El ID del evento debe ser un UUID válido."),
  session: z.enum(["morning", "afternoon"], {
    errorMap: () => ({ message: "La sesión debe ser mañana o tarde." }),
  }),
});
export type ClearRehearsalSessionInput = z.infer<typeof clearRehearsalSessionSchema>;
