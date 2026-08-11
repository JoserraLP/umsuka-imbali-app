import { createClient } from "@/lib/supabase/server";
import type { EventTypeValue } from "@/lib/events/schema";
import type { Workgroup } from "@/types/database.types";

export interface EventListItem {
  id: string;
  title: string;
  description: string | null;
  eventType: EventTypeValue;
  eventDate: string;
  capacity: number | null;
  /** Workgroup the event is restricted to. `null` = visible to everyone. */
  visibleToGroup: Workgroup | null;
  /** Workgroup of the lead who created the event (work_shift events only). */
  createdByWorkgroup: Workgroup | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ListEventsOptions {
  /** ISO timestamp, inclusive lower bound on event_date. */
  from?: string;
  /** ISO timestamp, exclusive upper bound on event_date. */
  to?: string;
}

/** Caller's group context, used to filter group-scoped events. */
export interface EventVisibility {
  workgroup: Workgroup;
  isManagement: boolean;
}

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  event_type: string;
  event_date: string;
  capacity: number | null;
  visible_to_group: Workgroup | null;
  created_by_workgroup: Workgroup | null;
  created_by: string | null;
  created_at: string;
}

function mapRow(row: EventRow): EventListItem {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    eventType: row.event_type as EventTypeValue,
    eventDate: row.event_date,
    capacity: row.capacity,
    visibleToGroup: row.visible_to_group,
    createdByWorkgroup: row.created_by_workgroup,
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
 * When `visibility` is provided, group-scoped events are filtered with
 * `isEventVisibleToGroup` (same rule as the RLS policy), so a barra
 * member only sees barra work_shift events and general events.
 */
export async function listEvents(
  options: ListEventsOptions = {},
  visibility?: EventVisibility,
): Promise<EventListItem[]> {
  const supabase = await createClient();

  let query = supabase
    .from("events")
    .select(
      "id, title, description, event_type, event_date, capacity, visible_to_group, created_by_workgroup, created_by, created_at",
    )
    .order("event_date", { ascending: true });

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
    return events.filter((event) => isEventVisibleToGroup(event, visibility.workgroup, visibility.isManagement));
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
    .select(
      "id, title, description, event_type, event_date, capacity, visible_to_group, created_by_workgroup, created_by, created_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch event ${id}: ${error.message}`);
  }

  const event = data ? mapRow(data) : null;

  if (event && visibility && !isEventVisibleToGroup(event, visibility.workgroup, visibility.isManagement)) {
    return null;
  }

  return event;
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
