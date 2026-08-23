import { createClient } from "@/lib/supabase/server";
import type { EventTypeValue } from "@/lib/events/schema";
import {
  getMyAudienceEventIds,
  isEventVisibleToAudience,
  type AudienceTypeValue,
} from "@/lib/events/audience";
import type { ComponentType, Workgroup } from "@/types/database.types";

export interface EventListItem {
  id: string;
  title: string;
  description: string | null;
  eventType: EventTypeValue;
  eventDate: string;
  capacity: number | null;
  /** Optional free-text venue description shown on the detail page. */
  location: string | null;
  /** Optional hero image URL (http/https only, rendered with a plain <img>). */
  imageUrl: string | null;
  /** Optional cutoff instant for new registrations (ISO timestamp). */
  registrationDeadline: string | null;
  /** Rehearsal sessions enabled (Sprint 27). Always false for non-rehearsal events. */
  morningSession: boolean;
  afternoonSession: boolean;
  /** Workgroup the event is restricted to. `null` = visible to everyone. */
  visibleToGroup: Workgroup | null;
  /** Workgroup of the lead who created the event (work_shift events only). */
  createdByWorkgroup: Workgroup | null;
  /** Audience scope (all/workgroup/member_type/specific_users). */
  audienceType: AudienceTypeValue;
  /** Target workgroup when audienceType = "workgroup". */
  audienceWorkgroup: Workgroup | null;
  /** Target member type when audienceType = "member_type". */
  audienceMemberType: ComponentType | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ListEventsOptions {
  /** ISO timestamp, inclusive lower bound on event_date. */
  from?: string;
  /** ISO timestamp, exclusive upper bound on event_date. */
  to?: string;
}

/**
 * Caller's context, used to filter group-scoped and audience-scoped
 * events (Sprint 18). `componentType` is required so the audience
 * mirror can match member_type events.
 */
export interface EventVisibility {
  workgroup: Workgroup;
  componentType: ComponentType;
  isManagement: boolean;
}

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  event_type: string;
  event_date: string;
  capacity: number | null;
  location: string | null;
  image_url: string | null;
  registration_deadline: string | null;
  morning_session: boolean;
  afternoon_session: boolean;
  visible_to_group: Workgroup | null;
  created_by_workgroup: Workgroup | null;
  audience_type: string | null;
  audience_workgroup: Workgroup | null;
  audience_member_type: ComponentType | null;
  created_by: string | null;
  created_at: string;
}

const EVENT_SELECT =
  "id, title, description, event_type, event_date, capacity, location, image_url, registration_deadline, morning_session, afternoon_session, visible_to_group, created_by_workgroup, audience_type, audience_workgroup, audience_member_type, created_by, created_at";

function mapRow(row: EventRow): EventListItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    eventType: row.event_type as EventTypeValue,
    eventDate: row.event_date,
    capacity: row.capacity,
    location: row.location,
    imageUrl: row.image_url,
    registrationDeadline: row.registration_deadline,
    morningSession: row.morning_session ?? false,
    afternoonSession: row.afternoon_session ?? false,
    visibleToGroup: row.visible_to_group,
    createdByWorkgroup: row.created_by_workgroup,
    audienceType: (row.audience_type as AudienceTypeValue) ?? "all",
    audienceWorkgroup: row.audience_workgroup,
    audienceMemberType: row.audience_member_type,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/**
 * Pure visibility rule mirroring the `events_select_authenticated` RLS
 * policy: an event is visible to a user when it is not group-restricted
 * (`visible_to_group = null`) or the user belongs to the target group.
 * Management is always allowed by the policy; callers that need that
 * exception must pass `isManagement` explicitly.
 */
export function isEventVisibleToGroup(
  event: Pick<EventListItem, "visibleToGroup">,
  userWorkgroup: Workgroup,
  isManagement = false,
): boolean {
  if (isManagement) return true;
  return event.visibleToGroup === null || event.visibleToGroup === userWorkgroup;
}

/**
 * Lists events, ordered chronologically. Relies on umsuka.events' "select
 * for any authenticated user" RLS policy — no elevated client is used
 * here. Pass `from`/`to` to scope to a date range (e.g. one calendar
 * month); omit both to list every event.
 *
 * When `visibility` is provided, events are filtered with the same "pure
 * mirror" of the RLS policy:
 * - management keeps the legacy group-only filter (isEventVisibleToGroup
 *   always returns true for management, so this is a no-op pass),
 * - non-management callers additionally fetch their own concrete
 *   audience rows (getMyAudienceEventIds) and run the full audience
 *   mirror (isEventVisibleToAudience). A getUser() failure fails closed
 *   (empty list).
 */
export async function listEvents(
  options: ListEventsOptions = {},
  visibility?: EventVisibility,
): Promise<EventListItem[]> {
  const supabase = await createClient();

  let query = supabase.from("events").select(EVENT_SELECT).order("event_date", { ascending: true });

  if (options.from) {
    query = query.gte("event_date", options.from);
  }
  if (options.to) {
    query = query.lt("event_date", options.to);
  }

  const { data, error } = await query;

  if (error) {
    throw new Error(`Failed to list events: ${error.message}`);
  }

  const events = (data ?? []).map(mapRow);

  if (visibility) {
    if (visibility.isManagement) {
      return events.filter((event) =>
        isEventVisibleToGroup(event, visibility.workgroup, true),
      );
    }

    const userId = await getViewerUserId(supabase);
    if (userId === null) {
      return []; // fail closed: cannot determine the viewer's audience set
    }
    const audienceEventIds = await getMyAudienceEventIds(userId, supabase);

    return events.filter((event) =>
      isEventVisibleToAudience(event, {
        userWorkgroup: visibility.workgroup,
        userComponent: visibility.componentType,
        audienceEventIds,
        isManagement: false,
      }),
    );
  }

  return events;
}

export async function getEventById(
  id: string,
  visibility?: EventVisibility,
): Promise<EventListItem | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("events")
    .select(EVENT_SELECT)
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch event ${id}: ${error.message}`);
  }

  const event = data ? mapRow(data) : null;

  if (event && visibility) {
    if (visibility.isManagement) {
      if (!isEventVisibleToGroup(event, visibility.workgroup, true)) {
        return null;
      }
      return event;
    }

    const userId = await getViewerUserId(supabase);
    if (userId === null) {
      return null; // fail closed: cannot determine the viewer's audience set
    }
    const audienceEventIds = await getMyAudienceEventIds(userId, supabase);

    if (
      !isEventVisibleToAudience(event, {
        userWorkgroup: visibility.workgroup,
        userComponent: visibility.componentType,
        audienceEventIds,
        isManagement: false,
      })
    ) {
      return null;
    }
  }

  return event;
}

/**
 * Reads the authenticated user id through the same client used for the
 * query. Returns `null` when the session cannot be resolved (fail closed).
 */
async function getViewerUserId(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string | null> {
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    return null;
  }
  return user.id;
}

/**
 * Alias of listEvents used by the Sprint 18 feed paths / server action
 * (getVisibleEventsAction). Kept as its own name so the audience-aware
 * feed is discoverable without changing established call sites.
 */
export async function getVisibleEvents(
  options: ListEventsOptions = {},
  visibility?: EventVisibility,
): Promise<EventListItem[]> {
  return listEvents(options, visibility);
}

export interface ShiftInfo {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
}

/**
 * Returns all shifts for a given event, ordered by start time.
 */
export async function getEventShifts(eventId: string): Promise<ShiftInfo[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("shifts")
    .select("id, name, start_time, end_time")
    .eq("event_id", eventId)
    .order("start_time", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch shifts for event ${eventId}: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    startTime: row.start_time,
    endTime: row.end_time,
  }));
}

// ── Event comments ─────────────────────────────────────

export interface EventComment {
  id: string;
  eventId: string;
  userId: string;
  body: string;
  createdAt: string;
  authorFirstName: string;
  authorLastName: string;
}

/**
 * Lists the comments of an event, newest first, enriching each row with
 * the author's display name. Follows the questions/queries.ts pattern:
 * umsuka.profiles references auth.users (no FK between event_comments and
 * profiles), so names are fetched separately and merged by id in JS.
 */
export async function getEventComments(eventId: string): Promise<EventComment[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_comments")
    .select("id, event_id, user_id, body, created_at")
    .eq("event_id", eventId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to fetch comments for event ${eventId}: ${error.message}`);
  }

  const userIds = [...new Set((data ?? []).map((row) => row.user_id))];
  const profilesById = new Map<string, { first_name: string; last_name: string }>();

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", userIds);

    if (profilesError) {
      throw new Error(`Failed to fetch comment author profiles: ${profilesError.message}`);
    }

    for (const profile of profiles ?? []) {
      profilesById.set(profile.id, {
        first_name: profile.first_name,
        last_name: profile.last_name,
      });
    }
  }

  return (data ?? []).map((row) => {
    const author = profilesById.get(row.user_id);
    return {
      id: row.id,
      eventId: row.event_id,
      userId: row.user_id,
      body: row.body,
      createdAt: row.created_at,
      authorFirstName: author?.first_name ?? "Miembro",
      authorLastName: author?.last_name ?? "",
    };
  });
}

// ── Event waitlist ────────────────────────────────────

export interface WaitlistEntry {
  id: string;
  eventId: string;
  userId: string;
  position: number;
  status: "waiting" | "promoted" | "declined" | "removed";
  joinedAt: string;
  promotedAt: string | null;
  firstName: string;
  lastName: string;
}

/**
 * Full waitlist for an event, ordered by FIFO position (then joined_at
 * as a tie-breaker). Access is management-only at the RLS level; caller
 * pages must gate on a management role before calling.
 */
export async function getWaitlistForEvent(eventId: string): Promise<WaitlistEntry[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_waitlist")
    .select("id, event_id, user_id, position, status, joined_at, promoted_at")
    .eq("event_id", eventId)
    .order("position", { ascending: true })
    .order("joined_at", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch waitlist for event ${eventId}: ${error.message}`);
  }

  const userIds = [...new Set((data ?? []).map((row) => row.user_id))];
  const profilesById = new Map<string, { first_name: string; last_name: string }>();

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", userIds);

    if (profilesError) {
      throw new Error(`Failed to fetch waitlist member profiles: ${profilesError.message}`);
    }

    for (const profile of profiles ?? []) {
      profilesById.set(profile.id, {
        first_name: profile.first_name,
        last_name: profile.last_name,
      });
    }
  }

  return (data ?? []).map((row) => {
    const member = profilesById.get(row.user_id);
    return {
      id: row.id,
      eventId: row.event_id,
      userId: row.user_id,
      position: row.position,
      status: row.status,
      joinedAt: row.joined_at,
      promotedAt: row.promoted_at,
      firstName: member?.first_name ?? "Miembro",
      lastName: member?.last_name ?? "",
    };
  });
}

/**
 * The viewer's own waitlist entry for an event, or `null` when they are
 * not on the list. Members can only ever see their own entry (RLS), so
 * this returns `null` for everyone else's rows.
 */
export async function getMyWaitlistEntry(
  eventId: string,
  userId: string,
): Promise<WaitlistEntry | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_waitlist")
    .select("id, event_id, user_id, position, status, joined_at, promoted_at")
    .eq("event_id", eventId)
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch waitlist entry for event ${eventId}: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id,
    eventId: data.event_id,
    userId: data.user_id,
    position: data.position,
    status: data.status,
    joinedAt: data.joined_at,
    promotedAt: data.promoted_at,
    firstName: "",
    lastName: "",
  };
}

// ── Registration status (pure helper) ──────────────────

export interface RegistrationStatusInput {
  capacity: number | null;
  registeredCount: number;
  registrationDeadline: string | null;
  viewerRegistered: boolean;
  viewerWaitlistPosition: number | null;
  /** Clock injection point so tests can pin "now". */
  now: Date;
}

export interface RegistrationStatus {
  capacity: number | null;
  registeredCount: number;
  registrationDeadline: string | null;
  isFull: boolean;
  isDeadlinePassed: boolean;
  /** True when new registrations are accepted (not full, deadline not passed). */
  registrationOpen: boolean;
  viewerStatus: "registered" | "waitlisted" | "none";
  viewerWaitlistPosition: number | null;
}

/**
 * Pure derived state for the event registration panel. Never touches the
 * DB — callers compose it from getEventRegistrationSummary() plus the
 * viewer's waitlist entry. A registered viewer always reports as
 * "registered" even when the event is full.
 */
export function computeRegistrationStatus(input: RegistrationStatusInput): RegistrationStatus {
  const isFull = input.capacity !== null && input.registeredCount >= input.capacity;

  const isDeadlinePassed =
    input.registrationDeadline !== null &&
    !Number.isNaN(Date.parse(input.registrationDeadline)) &&
    Date.parse(input.registrationDeadline) <= input.now.getTime();

  const viewerStatus: RegistrationStatus["viewerStatus"] = input.viewerRegistered
    ? "registered"
    : input.viewerWaitlistPosition !== null
      ? "waitlisted"
      : "none";

  return {
    capacity: input.capacity,
    registeredCount: input.registeredCount,
    registrationDeadline: input.registrationDeadline,
    isFull,
    isDeadlinePassed,
    registrationOpen: !isFull && !isDeadlinePassed,
    viewerStatus,
    viewerWaitlistPosition: input.viewerWaitlistPosition,
  };
}
