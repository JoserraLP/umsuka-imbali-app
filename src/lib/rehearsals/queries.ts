import { createClient } from "@/lib/supabase/server";
import type { RehearsalSession } from "@/types/database.types";
import type { SessionMark } from "@/lib/rehearsals/stats";

// ── Types ─────────────────────────────────────────────

export interface RehearsalAttendanceRecord {
  id: string;
  eventId: string;
  userId: string;
  session: RehearsalSession;
  attended: boolean;
  updatedAt: string;
  firstName: string;
  lastName: string;
}

export interface UserRehearsalAttendanceRecord {
  id: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  session: RehearsalSession;
  attended: boolean;
}

export interface RehearsalAttendanceSummary {
  morningPresent: number;
  afternoonPresent: number;
  totalRecords: number;
}

// ── Queries ───────────────────────────────────────────

/**
 * Returns all rehearsal attendance records for a given rehearsal,
 * enriched with attendee profile names using the two-query +
 * in-memory-join pattern (same as attendance/queries.ts).
 */
export async function getRehearsalAttendance(eventId: string): Promise<RehearsalAttendanceRecord[]> {
  const supabase = await createClient();

  const { data: records, error } = await supabase
    .from("rehearsal_attendance")
    .select("id, event_id, user_id, session, attended, updated_at")
    .eq("event_id", eventId)
    .order("session", { ascending: true })
    .order("updated_at", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to fetch rehearsal attendance for event ${eventId}: ${error.message}`,
    );
  }

  const rows = records ?? [];

  const userIds = Array.from(new Set(rows.map((row) => row.user_id).filter(Boolean)));

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

  return rows.map((row) => {
    const profile = profilesById.get(row.user_id);
    return {
      id: row.id,
      eventId: row.event_id ?? eventId,
      userId: row.user_id ?? "",
      session: (row.session ?? "morning") as RehearsalSession,
      attended: row.attended,
      updatedAt: row.updated_at,
      firstName: profile?.first_name ?? "Miembro",
      lastName: profile?.last_name ?? "",
    };
  });
}

/**
 * Returns the rehearsal attendance history for a specific user, with
 * event details (title, date) via a second query.
 */
export async function getUserRehearsalAttendance(
  userId: string,
): Promise<UserRehearsalAttendanceRecord[]> {
  const supabase = await createClient();

  const { data: records, error } = await supabase
    .from("rehearsal_attendance")
    .select("id, event_id, session, attended")
    .eq("user_id", userId)
    .order("event_id", { ascending: false });

  if (error) {
    throw new Error(
      `Failed to fetch rehearsal attendance for user ${userId}: ${error.message}`,
    );
  }

  const eventIds = Array.from(
    new Set((records ?? []).map((row) => row.event_id).filter(Boolean)),
  );

  const eventsById = new Map<string, { title: string; event_date: string }>();

  if (eventIds.length > 0) {
    const { data: events, error: eventsError } = await supabase
      .from("events")
      .select("id, title, event_date")
      .in("id", eventIds);

    if (eventsError) {
      throw new Error(`Failed to fetch rehearsal details: ${eventsError.message}`);
    }

    for (const event of events ?? []) {
      eventsById.set(event.id, { title: event.title, event_date: event.event_date });
    }
  }

  return (records ?? []).map((row) => {
    const event = eventsById.get(row.event_id ?? "");
    return {
      id: row.id,
      eventId: row.event_id ?? "",
      eventTitle: event?.title ?? "Evento desconocido",
      eventDate: event?.event_date ?? "",
      session: (row.session ?? "morning") as RehearsalSession,
      attended: row.attended,
    };
  });
}

/**
 * Returns the raw per-session marks for one member at one rehearsal.
 * Used to compute per-member participation percentages.
 */
export async function getUserEventSessionMarks(
  eventId: string,
  userId: string,
): Promise<SessionMark[]> {
  const supabase = await createClient();

  const { data: records, error } = await supabase
    .from("rehearsal_attendance")
    .select("session, attended")
    .eq("event_id", eventId)
    .eq("user_id", userId);

  if (error) {
    throw new Error(
      `Failed to fetch session marks for user ${userId} at event ${eventId}: ${error.message}`,
    );
  }

  return (records ?? []).map((row) => ({
    session: (row.session ?? "morning") as SessionMark["session"],
    attended: row.attended,
  }));
}

/**
 * Returns present counts per session plus the total record count for
 * a given rehearsal.
 */
export async function getRehearsalAttendanceSummary(
  eventId: string,
): Promise<RehearsalAttendanceSummary> {
  const supabase = await createClient();

  const { data: records, error } = await supabase
    .from("rehearsal_attendance")
    .select("session, attended")
    .eq("event_id", eventId);

  if (error) {
    throw new Error(
      `Failed to fetch rehearsal attendance summary for event ${eventId}: ${error.message}`,
    );
  }

  const rows = records ?? [];

  return {
    morningPresent: rows.filter((r) => r.session === "morning" && r.attended).length,
    afternoonPresent: rows.filter((r) => r.session === "afternoon" && r.attended).length,
    totalRecords: rows.length,
  };
}
