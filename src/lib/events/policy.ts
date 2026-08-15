import { createClient } from "@/lib/supabase/server";

/**
 * Event types that are attendance-only (Sprint 17b): meeting (reunión)
 * and carnival (carnaval). For these, shifts, workgroup attendance and
 * absences are not available — only attendance can be recorded.
 * `general` and `work_shift` events keep full functionality.
 */
export const ATTENDANCE_ONLY_EVENT_TYPES = ["meeting", "carnival"] as const;

export const SHIFTS_UNAVAILABLE_MESSAGE =
  "Los turnos no están disponibles para este tipo de evento.";

export const ABSENCES_UNAVAILABLE_MESSAGE =
  "Las ausencias no están disponibles para este tipo de evento.";

export const WORKGROUP_ATTENDANCE_UNAVAILABLE_MESSAGE =
  "La asistencia por grupo de trabajo no está disponible para este tipo de evento.";

/**
 * Pure predicate: true for meeting/carnival event types (attendance-only).
 */
export function isAttendanceOnlyEventType(eventType: string | null | undefined): boolean {
  if (eventType === null || eventType === undefined) return false;
  return (ATTENDANCE_ONLY_EVENT_TYPES as readonly string[]).includes(eventType);
}

/**
 * Reads the event_type of an event, or `null` when the event does not
 * exist (or is not visible to the caller).
 */
export async function getEventType(eventId: string): Promise<string | null> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("events")
    .select("event_type")
    .eq("id", eventId)
    .maybeSingle();

  return data?.event_type ?? null;
}

/**
 * Fails a mutation for attendance-only events (meeting/carnival).
 * Returns:
 * - `null` when the event exists and is NOT attendance-only (allowed),
 * - "Evento no encontrado." when the event does not exist (fail closed),
 * - `unavailableMessage` when the event is meeting/carnival.
 */
export async function rejectAttendanceOnlyEvent(
  eventId: string,
  unavailableMessage: string,
): Promise<string | null> {
  const eventType = await getEventType(eventId);
  if (eventType === null) {
    return "Evento no encontrado.";
  }
  if (isAttendanceOnlyEventType(eventType)) {
    return unavailableMessage;
  }
  return null;
}
