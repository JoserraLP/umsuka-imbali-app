import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface MeetingMinutesRow {
  id: string;
  eventId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReunionEventRow {
  id: string;
  title: string;
  eventDate: string;
  location: string | null;
  createdAt: string;
  hasMinutes: boolean;
  minutes: MeetingMinutesRow | null;
}

function mapMinutesRow(row: {
  id: string;
  event_id: string;
  file_path: string;
  file_name: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
}): MeetingMinutesRow {
  return {
    id: row.id,
    eventId: row.event_id,
    filePath: row.file_path,
    fileName: row.file_name,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getMinutesByEvent(eventId: string): Promise<MeetingMinutesRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meeting_minutes")
    .select("id, event_id, file_path, file_name, file_size, mime_type, uploaded_by, created_at, updated_at")
    .eq("event_id", eventId)
    .maybeSingle();

  if (error) throw new Error(`Error al obtener acta: ${error.message}`);
  if (!data) return null;
  return mapMinutesRow(data as never);
}

export async function getAllMinutes(): Promise<MeetingMinutesRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("meeting_minutes")
    .select("id, event_id, file_path, file_name, file_size, mime_type, uploaded_by, created_at, updated_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Error al obtener actas: ${error.message}`);
  return (data ?? []).map((r) => mapMinutesRow(r as never));
}

/**
 * Lista todos los eventos tipo reunion con flag hasMinutes y metadata de acta si existe.
 * Paginado simple + búsqueda por título opcional, filtro por rango fecha.
 */
export async function getReunionEvents(options?: {
  search?: string;
  fromDate?: string;
  toDate?: string;
  limit?: number;
  offset?: number;
}): Promise<ReunionEventRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("events")
    .select("id, title, event_date, location, created_at")
    .eq("event_type", "reunion")
    .order("event_date", { ascending: false });

  if (options?.search) {
    query = query.ilike("title", `%${options.search}%`);
  }
  if (options?.fromDate) {
    query = query.gte("event_date", options.fromDate);
  }
  if (options?.toDate) {
    query = query.lte("event_date", options.toDate);
  }
  if (options?.limit) {
    query = query.limit(options.limit);
  }
  if (options?.offset) {
    query = query.range(options.offset, (options.offset + (options.limit ?? 20) - 1));
  }

  const { data: events, error: eventsError } = await query;

  if (eventsError) throw new Error(`Error al obtener reuniones: ${eventsError.message}`);
  if (!events || events.length === 0) return [];

  const eventIds = events.map((e) => e.id);
  const { data: minutes, error: minutesError } = await supabase
    .from("meeting_minutes")
    .select("id, event_id, file_path, file_name, file_size, mime_type, uploaded_by, created_at, updated_at")
    .in("event_id", eventIds);

  if (minutesError) throw new Error(`Error al obtener actas: ${minutesError.message}`);

  const minutesByEventId = new Map<string, MeetingMinutesRow>();
  for (const m of minutes ?? []) {
    minutesByEventId.set(m.event_id, mapMinutesRow(m as never));
  }

  return events.map((e) => {
    const m = minutesByEventId.get(e.id) ?? null;
    return {
      id: e.id,
      title: e.title,
      eventDate: e.event_date,
      location: e.location,
      createdAt: e.created_at,
      hasMinutes: m !== null,
      minutes: m,
    };
  });
}
