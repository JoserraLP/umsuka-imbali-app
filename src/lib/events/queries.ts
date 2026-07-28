import { createClient } from "@/lib/supabase/server";
import type { EventTypeValue } from "@/lib/events/schema";

export interface EventListItem {
  id: string;
  title: string;
  description: string | null;
  eventType: EventTypeValue;
  eventDate: string;
  capacity: number | null;
  createdBy: string | null;
  createdAt: string;
}

export interface ListEventsOptions {
  /** ISO timestamp, inclusive lower bound on event_date. */
  from?: string;
  /** ISO timestamp, exclusive upper bound on event_date. */
  to?: string;
}

interface EventRow {
  id: string;
  title: string;
  description: string | null;
  event_type: string;
  event_date: string;
  capacity: number | null;
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
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

/**
 * Lists events, ordered chronologically. Relies on umsuka.events' "select
 * for any authenticated user" RLS policy — no elevated client is used
 * here. Pass `from`/`to` to scope to a date range (e.g. one calendar
 * month); omit both to list every event.
 */
export async function listEvents(options: ListEventsOptions = {}): Promise<EventListItem[]> {
  const supabase = await createClient();

  let query = supabase
    .from("events")
    .select("id, title, description, event_type, event_date, capacity, created_by, created_at")
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

  return (data ?? []).map(mapRow);
}

export async function getEventById(id: string): Promise<EventListItem | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("events")
    .select("id, title, description, event_type, event_date, capacity, created_by, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch event ${id}: ${error.message}`);
  }

  return data ? mapRow(data) : null;
}
