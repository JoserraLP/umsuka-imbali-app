import { createClient } from "@/lib/supabase/server";

export interface AttendanceRecord {
  id: string;
  eventId: string;
  userId: string;
  attended: boolean;
  createdAt: string;
  firstName: string;
  lastName: string;
}

export interface UserAttendanceRecord {
  id: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  attended: boolean;
  createdAt: string;
}

export interface AttendanceSummary {
  present: number;
  absent: number;
  total: number;
}

/**
 * Returns all attendance records for a given event, enriched with
 * attendee profile names using the two-query + in-memory-join pattern
 * (same as registrations/queries.ts).
 */
export async function getEventAttendance(eventId: string): Promise<AttendanceRecord[]> {
  const supabase = await createClient();

  const { data: records, error } = await supabase
    .from("attendance")
    .select("id, event_id, user_id, attended, created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch attendance for event ${eventId}: ${error.message}`);
  }

  const userIds = (records ?? [])
    .map((row) => row.user_id)
    .filter((id): id is string => id !== null);

  const profilesById = new Map<string, { first_name: string; last_name: string }>();

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", userIds);

    if (profilesError) {
      throw new Error(`Failed to fetch attendee profiles: ${profilesError.message}`);
    }

    for (const profile of profiles ?? []) {
      profilesById.set(profile.id, {
        first_name: profile.first_name,
        last_name: profile.last_name,
      });
    }
  }

  return (records ?? []).map((row) => {
    const profile = row.user_id ? profilesById.get(row.user_id) : undefined;
    return {
      id: row.id,
      eventId: row.event_id ?? eventId,
      userId: row.user_id ?? "",
      attended: row.attended,
      createdAt: row.created_at,
      firstName: profile?.first_name ?? "Miembro",
      lastName: profile?.last_name ?? "",
    };
  });
}

/**
 * Returns the attendance history for a specific user, with event
 * details (title, date) via a second query.
 */
export async function getUserAttendance(userId: string): Promise<UserAttendanceRecord[]> {
  const supabase = await createClient();

  const { data: records, error } = await supabase
    .from("attendance")
    .select("id, event_id, attended, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch attendance for user ${userId}: ${error.message}`);
  }

  const eventIds = (records ?? [])
    .map((row) => row.event_id)
    .filter((id): id is string => id !== null);

  const eventsById = new Map<string, { title: string; event_date: string }>();

  if (eventIds.length > 0) {
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("id, title, event_date")
      .in("id", eventIds);

    if (eventsError) {
      throw new Error(`Failed to fetch event details: ${eventsError.message}`);
    }

    for (const event of events ?? []) {
      eventsById.set(event.id, { title: event.title, event_date: event.event_date });
    }
  }

  return (records ?? []).map((row) => {
    const event = row.event_id ? eventsById.get(row.event_id) : undefined;
    return {
      id: row.id,
      eventId: row.event_id ?? "",
      eventTitle: event?.title ?? "Evento desconocido",
      eventDate: event?.event_date ?? "",
      attended: row.attended,
      createdAt: row.created_at,
    };
  });
}

/**
 * Returns a summary of attendance counts for a given event.
 */
export async function getEventAttendanceSummary(eventId: string): Promise<AttendanceSummary> {
  const supabase = await createClient();

  const { data: records, error } = await supabase
    .from("attendance")
    .select("attended")
    .eq("event_id", eventId);

  if (error) {
    throw new Error(
      `Failed to fetch attendance summary for event ${eventId}: ${error.message}`,
    );
  }

  const present = (records ?? []).filter((r) => r.attended).length;
  const absent = (records ?? []).filter((r) => !r.attended).length;

  return {
    present,
    absent,
    total: present + absent,
  };
}
