import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { CarnivalYearStatus } from "@/lib/carnival/schema";

export interface CarnivalYearRow {
  id: string;
  year: number;
  label: string;
  startDate: string;
  endDate: string | null;
  status: CarnivalYearStatus;
  createdBy: string | null;
  createdAt: string;
}

export interface SnapshotRow {
  id: string;
  carnivalYearId: string;
  snapshotType: string;
  data: unknown;
  createdAt: string;
}

function mapYear(row: {
  id: string;
  year: number;
  label: string;
  start_date: string;
  end_date: string | null;
  status: CarnivalYearStatus;
  created_by: string | null;
  created_at: string;
}): CarnivalYearRow {
  return {
    id: row.id,
    year: row.year,
    label: row.label,
    startDate: row.start_date,
    endDate: row.end_date,
    status: row.status,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

function mapSnapshot(row: {
  id: string;
  carnival_year_id: string;
  snapshot_type: string;
  data: unknown;
  created_at: string;
}): SnapshotRow {
  return {
    id: row.id,
    carnivalYearId: row.carnival_year_id,
    snapshotType: row.snapshot_type,
    data: row.data,
    createdAt: row.created_at,
  };
}

export async function getActiveYear(): Promise<CarnivalYearRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("carnival_years")
    .select("id, year, label, start_date, end_date, status, created_by, created_at")
    .eq("status", "active")
    .maybeSingle();
  if (error) throw new Error(`Error al obtener año activo: ${error.message}`);
  if (!data) return null;
  return mapYear(data as never);
}

export async function getCarnivalYears(): Promise<CarnivalYearRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("carnival_years")
    .select("id, year, label, start_date, end_date, status, created_by, created_at")
    .order("year", { ascending: false });
  if (error) throw new Error(`Error al listar años: ${error.message}`);
  return (data ?? []).map((r) => mapYear(r as never));
}

export async function getYearById(id: string): Promise<CarnivalYearRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("carnival_years")
    .select("id, year, label, start_date, end_date, status, created_by, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Error al obtener año: ${error.message}`);
  if (!data) return null;
  return mapYear(data as never);
}

export async function getSnapshotsByYearId(yearId: string): Promise<SnapshotRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("carnival_year_snapshots")
    .select("id, carnival_year_id, snapshot_type, data, created_at")
    .eq("carnival_year_id", yearId)
    .order("snapshot_type", { ascending: true });
  if (error) throw new Error(`Error al obtener snapshots: ${error.message}`);
  return (data ?? []).map((r) => mapSnapshot(r as never));
}

export async function getSnapshotSection(yearId: string, snapshotType: string): Promise<SnapshotRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("carnival_year_snapshots")
    .select("id, carnival_year_id, snapshot_type, data, created_at")
    .eq("carnival_year_id", yearId)
    .eq("snapshot_type", snapshotType)
    .maybeSingle();
  if (error) throw new Error(`Error al obtener snapshot: ${error.message}`);
  if (!data) return null;
  return mapSnapshot(data as never);
}
