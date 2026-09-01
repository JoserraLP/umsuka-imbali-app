import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { SNAPSHOT_TYPES } from "@/lib/carnival/schema";

export type MutationResult<T = unknown> = { success: true; data: T } | { success: false; error: string };

function requireManagementGuard(profile: Awaited<ReturnType<typeof getCurrentProfile>>): MutationResult<never> | null {
  if (!profile) return { success: false, error: "No autenticado." };
  if (!isManagementRole(profile.role as never)) return { success: false, error: "Solo la directiva o super_admin pueden gestionar el año de carnaval." };
  return null;
}

/**
 * Serializa TODO el año a snapshots. Usa admin client para bypass RLS pero
 * valida guard antes. Inserta una fila por SNAPSHOT_TYPES y sube JSON a Storage.
 */
export async function createSnapshot(yearId: string): Promise<MutationResult> {
  const profile = await getCurrentProfile();
  const guard = requireManagementGuard(profile);
  if (guard) return guard;

  const admin = createAdminClient();
  const supabase = await createClient();

  // Verify year exists
  const { data: year, error: yearError } = await supabase
    .from("carnival_years")
    .select("id, year, label")
    .eq("id", yearId)
    .maybeSingle();
  if (yearError) return { success: false, error: yearError.message };
  if (!year) return { success: false, error: "Año no encontrado." };

  // Helper to fetch table or empty array on error
  async function fetchTable(table: string, select = "*"): Promise<unknown[]> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (admin as any).from(table).select(select);
      if (error) return [];
      return (data ?? []) as unknown[];
    } catch {
      return [];
    }
  }

  // Gather all sections (best-effort, empty array if table missing)
  const [
    members,
    events,
    questions,
    votings,
    payments,
    attendance,
    rehearsalAttendance,
    shifts,
    formations,
    instruments,
    transactions,
    stats, // derived from payments/attendance counts
  ] = await Promise.all([
    fetchTable("profiles", "id, first_name, last_name, component_type, workgroup, role, is_active, status, created_at, deleted_at"),
    fetchTable("events", "id, title, event_type, event_date, carnival_year_id, created_at"),
    fetchTable("questions", "id, title, resolved, created_at"),
    fetchTable("votings", "id, title, is_open, created_at"),
    fetchTable("member_payments", "id, user_id, payment_type, period_year, amount, carnival_year_id"),
    fetchTable("attendance", "id, event_id, user_id, attended"),
    fetchTable("rehearsal_attendance", "id, event_id, user_id, session, attended, enrolled"),
    fetchTable("shifts", "id, event_id, name, start_time, end_time"),
    fetchTable("dance_formations", "id, name, formation_type, carnival_year_id"),
    fetchTable("instruments", "id, name, category, is_active"),
    fetchTable("transactions", "id, type, category, amount, carnival_year_id"),
    // stats as counts
    (async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { count } = await (admin as any).from("profiles").select("id", { count: "exact", head: true });
      return [{ totalMembers: count ?? 0 }];
    })(),
  ]);

  const sections: Record<string, unknown> = {
    members,
    events,
    questions,
    votings,
    payments,
    attendance,
    rehearsal_attendance: rehearsalAttendance,
    shifts,
    formations,
    instruments,
    transactions,
    stats,
  };

  // Insert snapshots per type
  for (const type of SNAPSHOT_TYPES) {
    const data = (sections as Record<string, unknown>)[type] ?? sections[type] ?? [];
    const { error } = await admin.from("carnival_year_snapshots").upsert(
      {
        carnival_year_id: yearId,
        snapshot_type: type,
        data: data as never,
      },
      { onConflict: "carnival_year_id,snapshot_type" },
    );
    if (error) return { success: false, error: `Error al guardar snapshot ${type}: ${error.message}` };
  }

  // Also upload full backup JSON to Storage
  const fullBackup = {
    year: (year as { year: number }).year,
    label: (year as { label: string }).label,
    yearId,
    createdAt: new Date().toISOString(),
    createdBy: profile!.id,
    sections,
  };

  const filePath = `${(year as { year: number }).year}.json`;
  const jsonBody = JSON.stringify(fullBackup, null, 2);
  const { error: uploadError } = await admin.storage
    .from("carnival-backups")
    .upload(filePath, new Blob([jsonBody], { type: "application/json" }), {
      contentType: "application/json",
      upsert: true,
    });
  if (uploadError) return { success: false, error: `Error al subir backup a Storage: ${uploadError.message}` };

  return { success: true, data: null };
}

/** Año carnavalero marzo→febrero: helper para mapear fecha a año carnavalero. */
export function getCarnivalYearForDate(date: Date | string): number {
  const d = typeof date === "string" ? new Date(date) : date;
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + 1;
  return m >= 3 ? y : y - 1;
}

/** Último día de febrero de un año dado (28 o 29). */
export function getLastDayOfFebruary(year: number): string {
  const lastDay = new Date(Date.UTC(year, 2, 0)).getUTCDate();
  return `${year}-02-${String(lastDay).padStart(2, "0")}`;
}

/** 1 de marzo de un año dado. */
export function getMarchFirst(year: number): string {
  return `${year}-03-01`;
}

/**
 * Inicia nuevo año: archiva activo, crea snapshot, crea nuevo año.
 * Año carnavalero marzo→febrero: archiva con end_date = último día de febrero de year+1,
 * nuevo año empieza el 1 de marzo de nextYear. Transacción best-effort con rollback si falla snapshot.
 */
export async function startNewYear(input: { label: string; startDate: string; confirmText: string }): Promise<MutationResult<{ newYearId: string }>> {
  const profile = await getCurrentProfile();
  const guard = requireManagementGuard(profile);
  if (guard) return guard;

  if (input.confirmText !== "AÑO" && input.confirmText !== "ANO" && input.confirmText.toUpperCase() !== "AÑO") {
    return { success: false, error: "Confirmación incorrecta. Escribe AÑO para confirmar." };
  }

  const admin = createAdminClient();
  const supabase = await createClient();

  // Get active year
  const { data: active, error: activeError } = await supabase
    .from("carnival_years")
    .select("id, year, label")
    .eq("status", "active")
    .maybeSingle();
  if (activeError) return { success: false, error: activeError.message };
  if (!active) return { success: false, error: "No hay año activo para archivar." };

  // 1. Create snapshot of active year (must succeed before archiving)
  const snap = await createSnapshot(active.id as string);
  if (!snap.success) return { success: false, error: `Fallo al crear copia de seguridad: ${snap.error}. El año no se ha archivado.` };

  // 2. Archive active year con fin en febrero (marzo→febrero)
  const activeYearNum = (active as { year: number }).year;
  const archiveEndDate = getLastDayOfFebruary(activeYearNum + 1);
  const { error: archiveError } = await admin
    .from("carnival_years")
    .update({ status: "archived" as never, end_date: archiveEndDate as never })
    .eq("id", active.id as string);
  if (archiveError) return { success: false, error: `Error al archivar año: ${archiveError.message}` };

  // 3. Create new year (year = max+1 or current+1) empezando el 1 de marzo
  const { data: maxYearRow } = await supabase.from("carnival_years").select("year").order("year", { ascending: false }).limit(1).maybeSingle();
  const nextYear = Math.max(((maxYearRow as { year: number } | null)?.year ?? activeYearNum), new Date().getFullYear()) + 1;
  const computedStartDate = getMarchFirst(nextYear);
  // Si el usuario mandó una fecha distinta pero válida (marzo), la respetamos; si no, usamos el 1 de marzo calculado
  const startDateToUse = input.startDate && isMarchFirst(input.startDate) ? input.startDate : computedStartDate;
  // Helper local para validar marzo
  function isMarchFirst(d: string): boolean {
    const dt = new Date(d);
    return !Number.isNaN(dt.getTime()) && dt.getUTCMonth() + 1 === 3 && dt.getUTCDate() === 1;
  }
  const { data: newYear, error: newYearError } = await admin
    .from("carnival_years")
    .insert({
      year: nextYear,
      label: input.label,
      start_date: startDateToUse as never,
      status: "active" as never,
      created_by: profile!.id as never,
    } as never)
    .select("id")
    .single();
  if (newYearError) {
    // Rollback archive (re-activate)
    await admin.from("carnival_years").update({ status: "active" as never, end_date: null as never }).eq("id", active.id as string);
    return { success: false, error: `Error al crear nuevo año: ${newYearError.message}` };
  }

  const newYearId = (newYear as { id: string }).id;

  // 4. Reset counters: for MVP, new year starts with empty carnival_year_id associations.
  // Existing data retains old year id; new inserts will use newYearId via default handling in mutations.
  // For formations/positions, we don't delete but new year positions are empty by definition (no rows with new id yet).
  // No need to clear payments/transactions — they are filtered by year.

  return { success: true, data: { newYearId } };
}
