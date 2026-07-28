import { createClient } from "@/lib/supabase/server";

export interface EventRegistrationAttendee {
  registrationId: string;
  userId: string;
  firstName: string;
  lastName: string;
  registeredAt: string;
}

export interface EventRegistrationSummary {
  count: number;
  capacity: number | null;
  isFull: boolean;
  isViewerRegistered: boolean;
  attendees: EventRegistrationAttendee[];
}

/**
 * Builds the full registration picture for one event: capacity, current
 * count, whether the viewer is registered, and the attendee list with
 * display names.
 *
 * Note on the two-query + in-memory-join approach below: umsuka.profiles
 * and umsuka.event_registrations both reference auth.users independently
 * (there is no direct foreign key between them), so PostgREST cannot
 * auto-detect an embed relationship between the two tables. Fetching
 * registrations and profiles separately and merging by id in JS avoids
 * relying on any such inference.
 */
export async function getEventRegistrationSummary(
  eventId: string,
  viewerId: string,
): Promise<EventRegistrationSummary> {
  const supabase = await createClient();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("capacity")
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) {
    throw new Error(`Failed to fetch event capacity: ${eventError.message}`);
  }

  const { data: registrations, error: registrationsError } = await supabase
    .from("event_registrations")
    .select("id, user_id, created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: true });

  if (registrationsError) {
    throw new Error(`Failed to fetch registrations: ${registrationsError.message}`);
  }

  const userIds = (registrations ?? []).map((row) => row.user_id);
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
      profilesById.set(profile.id, { first_name: profile.first_name, last_name: profile.last_name });
    }
  }

  const attendees: EventRegistrationAttendee[] = (registrations ?? []).map((row) => {
    const profile = profilesById.get(row.user_id);
    return {
      registrationId: row.id,
      userId: row.user_id,
      firstName: profile?.first_name ?? "Miembro",
      lastName: profile?.last_name ?? "",
      registeredAt: row.created_at,
    };
  });

  const capacity = event?.capacity ?? null;
  const count = attendees.length;

  return {
    count,
    capacity,
    isFull: capacity !== null && count >= capacity,
    isViewerRegistered: attendees.some((attendee) => attendee.userId === viewerId),
    attendees,
  };
}
