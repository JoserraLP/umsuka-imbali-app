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
  eventId: z.string().uuid("eventId must be a valid UUID."),
  userId: z.string().uuid("userId must be a valid UUID."),
  session: z.enum(["morning", "afternoon"], {
    errorMap: () => ({ message: "session must be 'morning' or 'afternoon'." }),
  }),
  attended: z.boolean({ required_error: "attended is required." }),
});
export type MarkRehearsalAttendanceInput = z.infer<typeof markRehearsalAttendanceSchema>;

export const markMultipleRehearsalAttendanceSchema = z.object({
  records: z
    .array(markRehearsalAttendanceSchema)
    .min(1, "At least one rehearsal attendance record is required."),
});
export type MarkMultipleRehearsalAttendanceInput = z.infer<
  typeof markMultipleRehearsalAttendanceSchema
>;

export const clearRehearsalSessionSchema = z.object({
  eventId: z.string().uuid("eventId must be a valid UUID."),
  session: z.enum(["morning", "afternoon"], {
    errorMap: () => ({ message: "session must be 'morning' or 'afternoon'." }),
  }),
});
export type ClearRehearsalSessionInput = z.infer<typeof clearRehearsalSessionSchema>;
