import { createClient } from "@/lib/supabase/server";

export interface AbsenceRecord {
  id: string;
  userId: string;
  eventId: string;
  firstName: string;
  lastName: string;
  reason: string | null;
  justified: boolean;
  createdAt: string;
}

export interface UserAbsenceRecord {
  id: string;
  eventId: string;
  eventTitle: string;
  eventDate: string;
  reason: string | null;
  justified: boolean;
  createdAt: string;
}

interface AbsenceRow {
  id: string;
  user_id: string | null;
  event_id: string | null;
  reason: string | null;
  justified: boolean;
  created_at: string;
}

/**
 * Enriches absence rows with user profile names using the two-query +
 * in-memory-join pattern (same as registrations/queries.ts).
 */
async function resolveProfiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: AbsenceRow[],
  defaultEventId: string,
): Promise<AbsenceRecord[]> {
  const userIds = rows
    .map((row) => row.user_id)
    .filter((id): id is string => id !== null);

  const profilesById = new Map<string, { first_name: string; last_name: string }>();

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", userIds);

    if (profilesError) {
      throw new Error(`Failed to fetch profiles: ${profilesError.message}`);
    }

    for (const profile of profiles ?? []) {
      profilesById.set(profile.id, {
        first_name: profile.first_name,
        last_name: profile.last_name,
      });
    }
  }

  return rows.map((row) => {
    const profile = row.user_id ? profilesById.get(row.user_id) : undefined;
    return {
      id: row.id,
      userId: row.user_id ?? "",
      eventId: row.event_id ?? defaultEventId,
      firstName: profile?.first_name ?? "Miembro",
      lastName: profile?.last_name ?? "",
      reason: row.reason,
      justified: row.justified,
      createdAt: row.created_at,
    };
  });
}

/**
 * Returns all absence records for a given event, enriched with
 * user profile names.
 */
export async function getEventAbsences(eventId: string): Promise<AbsenceRecord[]> {
  const supabase = await createClient();

  const { data: records, error } = await supabase
    .from("absences")
    .select("id, user_id, event_id, reason, justified, created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch absences for event ${eventId}: ${error.message}`);
  }

  return resolveProfiles(supabase, records ?? [], eventId);
}

/**
 * Returns the absence history for a specific user, with event
 * details (title, date).
 */
export async function getUserAbsences(userId: string): Promise<UserAbsenceRecord[]> {
  const supabase = await createClient();

  const { data: records, error } = await supabase
    .from("absences")
    .select("id, event_id, reason, justified, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch absences for user ${userId}: ${error.message}`);
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
      reason: row.reason,
      justified: row.justified,
      createdAt: row.created_at,
    };
  });
}

/**
 * Returns all absences that have not yet been justified (justified = false),
 * enriched with user profile names. Useful for management dashboards.
 */
export async function getPendingAbsences(): Promise<AbsenceRecord[]> {
  const supabase = await createClient();

  const { data: records, error } = await supabase
    .from("absences")
    .select("id, user_id, event_id, reason, justified, created_at")
    .eq("justified", false)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch pending absences: ${error.message}`);
  }

  return resolveProfiles(supabase, records ?? [], "");
}
