import "server-only";

import { createClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────────

export interface FormationListItem {
  id: string;
  name: string;
  eventId: string | null;
  createdBy: string | null;
  createdAt: string;
}

export interface PositionWithMember {
  id: string;
  formationId: string;
  rowNumber: number;
  seatNumber: number;
  memberId: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  createdAt: string;
}

export interface FormationDetail extends FormationListItem {
  positions: PositionWithMember[];
}

export interface AvailableDancer {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

export interface AvailableInstrument {
  id: string;
  name: string;
  category: string | null;
  isActive: boolean;
}

export interface MusicianInstrumentRow {
  id: string;
  userId: string;
  instrumentId: string;
  formationId: string | null;
  assignedBy: string | null;
  assignedAt: string;
  firstName: string;
  lastName: string;
  instrumentName: string;
  instrumentCategory: string | null;
}

// ── Helpers ───────────────────────────────────────────

async function mergePositionsWithProfiles(
  supabase: Awaited<ReturnType<typeof createClient>>,
  positions: Array<{
    id: string;
    formation_id: string;
    row_number: number;
    seat_number: number;
    member_id: string | null;
    created_at: string;
  }>,
): Promise<PositionWithMember[]> {
  const memberIds = [...new Set(positions.map((p) => p.member_id).filter(Boolean) as string[])];
  const profilesById = new Map<string, { first_name: string; last_name: string; avatar_url: string | null }>();

  if (memberIds.length > 0) {
    const { data: profiles, error } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, avatar_url")
      .in("id", memberIds);
    if (error) throw new Error(`Error al obtener perfiles: ${error.message}`);
    for (const p of profiles ?? []) {
      profilesById.set(p.id, {
        first_name: p.first_name,
        last_name: p.last_name,
        avatar_url: p.avatar_url,
      });
    }
  }

  return positions.map((pos) => {
    const member = pos.member_id ? profilesById.get(pos.member_id) : null;
    return {
      id: pos.id,
      formationId: pos.formation_id,
      rowNumber: pos.row_number,
      seatNumber: pos.seat_number,
      memberId: pos.member_id,
      firstName: member?.first_name ?? null,
      lastName: member?.last_name ?? null,
      avatarUrl: member?.avatar_url ?? null,
      createdAt: pos.created_at,
    };
  });
}

// ── Queries ───────────────────────────────────────────

export async function getFormations(): Promise<FormationListItem[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("dance_formations")
    .select("id, name, event_id, created_by, created_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Error al obtener formaciones: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    name: row.name,
    eventId: row.event_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
  }));
}

export async function getFormationById(id: string): Promise<FormationDetail | null> {
  const supabase = await createClient();

  const { data: formation, error: formationError } = await supabase
    .from("dance_formations")
    .select("id, name, event_id, created_by, created_at")
    .eq("id", id)
    .maybeSingle();

  if (formationError) throw new Error(`Error al obtener la formación: ${formationError.message}`);
  if (!formation) return null;

  const { data: positions, error: positionsError } = await supabase
    .from("dance_positions")
    .select("id, formation_id, row_number, seat_number, member_id, created_at")
    .eq("formation_id", id)
    .order("row_number", { ascending: true })
    .order("seat_number", { ascending: true });

  if (positionsError) throw new Error(`Error al obtener posiciones: ${positionsError.message}`);

  const enriched = await mergePositionsWithProfiles(supabase, positions ?? []);

  return {
    id: formation.id,
    name: formation.name,
    eventId: formation.event_id,
    createdBy: formation.created_by,
    createdAt: formation.created_at,
    positions: enriched,
  };
}

export async function getFormationByEventId(eventId: string): Promise<FormationDetail | null> {
  const supabase = await createClient();
  const { data: formation, error } = await supabase
    .from("dance_formations")
    .select("id")
    .eq("event_id", eventId)
    .maybeSingle();

  if (error) throw new Error(`Error al obtener formación por evento: ${error.message}`);
  if (!formation) return null;
  return getFormationById(formation.id);
}

/**
 * Bailarinas disponibles: filtradas por component_type='dance', is_active,
 * status active, deleted_at null. Nunca por workgroup (ADR-032).
 */
export async function getAvailableDancers(): Promise<AvailableDancer[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, avatar_url")
    .eq("component_type", "dance")
    .eq("is_active", true)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("first_name", { ascending: true });

  if (error) throw new Error(`Error al obtener bailarinas: ${error.message}`);

  return (data ?? []).map((p) => ({
    id: p.id,
    firstName: p.first_name,
    lastName: p.last_name,
    avatarUrl: p.avatar_url,
  }));
}

/**
 * Instrumentos disponibles para asignar en una formación: is_active true
 * y no asignado en esa formación (y global si formationId null).
 */
export async function getAvailableInstruments(formationId: string | null = null): Promise<AvailableInstrument[]> {
  const supabase = await createClient();

  const { data: instruments, error: instrumentsError } = await supabase
    .from("instruments")
    .select("id, name, category, is_active")
    .eq("is_active", true)
    .order("name", { ascending: true });

  if (instrumentsError) throw new Error(`Error al obtener instrumentos: ${instrumentsError.message}`);

  // Filter out those already assigned in the target formation context
  let assignedInstrumentIds = new Set<string>();

  if (instruments && instruments.length > 0) {
    let query = supabase.from("musician_instruments").select("instrument_id");
    if (formationId) {
      query = query.eq("formation_id", formationId);
    } else {
      query = query.is("formation_id", null);
    }
    const { data: assigned, error: assignedError } = await query;
    if (assignedError) throw new Error(`Error al obtener instrumentos asignados: ${assignedError.message}`);
    assignedInstrumentIds = new Set((assigned ?? []).map((r) => r.instrument_id));
  }

  return (instruments ?? [])
    .filter((inst) => !assignedInstrumentIds.has(inst.id))
    .map((inst) => ({
      id: inst.id,
      name: inst.name,
      category: inst.category,
      isActive: inst.is_active,
    }));
}

export async function getMusicianInstruments(formationId: string | null = null): Promise<MusicianInstrumentRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("musician_instruments")
    .select("id, user_id, instrument_id, formation_id, assigned_by, assigned_at")
    .order("assigned_at", { ascending: false });

  if (formationId !== null) {
    query = query.eq("formation_id", formationId);
  } else {
    // formationId === null → filtrar asignaciones globales (base sin formación)
    query = query.is("formation_id", null);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Error al obtener instrumentos de músicos: ${error.message}`);

  const rows = data ?? [];
  if (rows.length === 0) return [];

  const userIds = [...new Set(rows.map((r) => r.user_id))];
  const instrumentIds = [...new Set(rows.map((r) => r.instrument_id))];

  const [{ data: profiles }, { data: instruments }] = await Promise.all([
    supabase.from("profiles").select("id, first_name, last_name").in("id", userIds),
    supabase.from("instruments").select("id, name, category").in("id", instrumentIds),
  ]);

  const profilesById = new Map((profiles ?? []).map((p) => [p.id, p]));
  const instrumentsById = new Map((instruments ?? []).map((i) => [i.id, i]));

  return rows.map((row) => {
    const profile = profilesById.get(row.user_id) as { first_name: string; last_name: string } | undefined;
    const instrument = instrumentsById.get(row.instrument_id) as { name: string; category: string | null } | undefined;
    return {
      id: row.id,
      userId: row.user_id,
      instrumentId: row.instrument_id,
      formationId: row.formation_id,
      assignedBy: row.assigned_by,
      assignedAt: row.assigned_at,
      firstName: profile?.first_name ?? "Músico",
      lastName: profile?.last_name ?? "",
      instrumentName: instrument?.name ?? "Instrumento",
      instrumentCategory: instrument?.category ?? null,
    };
  });
}

/**
 * Lista músicos disponibles (component_type='music') para selector de instrumentos.
 */
export async function getAvailableMusicians(): Promise<AvailableDancer[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, avatar_url")
    .eq("component_type", "music")
    .eq("is_active", true)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("first_name", { ascending: true });

  if (error) throw new Error(`Error al obtener músicos: ${error.message}`);

  return (data ?? []).map((p) => ({
    id: p.id,
    firstName: p.first_name,
    lastName: p.last_name,
    avatarUrl: p.avatar_url,
  }));
}
