import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { requirePermission } from "@/lib/admin/permissions";
import {
  mapSettingsRow,
  mapAuditLogRow,
  AUDIT_PAGE_SIZE,
  type AuditLogFilters,
  type AuditLogItem,
  type SettingsItem,
} from "@/lib/admin/schema";
import { listProfiles, type ProfileListItem } from "@/lib/profiles/queries";

/**
 * Server-side admin queries (Sprint 21). Every query starts by resolving
 * the authenticated actor and re-checking the granular permission it
 * serves (`users.read` / `settings.read` / `audit.read`); RLS on the new
 * tables remains the backstop for the authenticated client used here.
 */

/**
 * One row of the admin users table: the directory projection plus the
 * masked email resolved through `umsuka.get_user_emails` (internal
 * aliases come back null and render as "—" in the UI — never exposed).
 */
export type AdminUserRow = ProfileListItem & { email: string | null };

/** Lists every global setting, sorted by key. */
export async function listSettings(): Promise<SettingsItem[]> {
  const actor = await requireAuthenticatedProfile();
  requirePermission(actor.role, "settings.read");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("settings")
    .select("key, value, updated_by, updated_at")
    .order("key", { ascending: true });

  if (error) {
    throw new Error(`Error al obtener la configuración: ${error.message}`);
  }

  return (data ?? []).map(mapSettingsRow);
}

/** Returns one setting by key, or null when the key has no row. */
export async function getSetting(key: string): Promise<SettingsItem | null> {
  const actor = await requireAuthenticatedProfile();
  requirePermission(actor.role, "settings.read");

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("settings")
    .select("key, value, updated_by, updated_at")
    .eq("key", key)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al obtener la configuración: ${error.message}`);
  }

  return data ? mapSettingsRow(data) : null;
}

/**
 * Paged audit log with optional filters (user, action, from/to dates).
 * A head-only count query plus the data page run in parallel; actor
 * display names are resolved with a single profiles `.in()` query and
 * fall back to "Usuario eliminado" for deleted/missing accounts (the FK
 * nulls out user_id on delete).
 */
export async function listAuditLogs(
  filters: AuditLogFilters,
): Promise<{ items: AuditLogItem[]; total: number; hasMore: boolean }> {
  const actor = await requireAuthenticatedProfile();
  requirePermission(actor.role, "audit.read");

  const supabase = await createClient();

  let countQuery = supabase
    .from("audit_logs")
    .select("id", { count: "exact", head: true });

  let dataQuery = supabase
    .from("audit_logs")
    .select("id, user_id, action, entity_type, entity_id, details, created_at")
    .order("created_at", { ascending: false })
    .range(filters.offset, filters.offset + AUDIT_PAGE_SIZE - 1);

  if (filters.user) {
    countQuery = countQuery.eq("user_id", filters.user);
    dataQuery = dataQuery.eq("user_id", filters.user);
  }
  if (filters.action) {
    countQuery = countQuery.eq("action", filters.action);
    dataQuery = dataQuery.eq("action", filters.action);
  }
  if (filters.from) {
    countQuery = countQuery.gte("created_at", filters.from);
    dataQuery = dataQuery.gte("created_at", filters.from);
  }
  if (filters.toEndOfDay) {
    countQuery = countQuery.lte("created_at", filters.toEndOfDay);
    dataQuery = dataQuery.lte("created_at", filters.toEndOfDay);
  }

  const [{ count, error: countError }, { data, error }] = await Promise.all([
    countQuery,
    dataQuery,
  ]);

  if (countError) {
    throw new Error(`Error al obtener los registros de auditoría: ${countError.message}`);
  }
  if (error) {
    throw new Error(`Error al obtener los registros de auditoría: ${error.message}`);
  }

  const rows = data ?? [];
  const total = count ?? 0;

  const actorIds = [...new Set(rows.map((row) => row.user_id).filter((id): id is string => id !== null))];

  let names = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: profileRows, error: profileError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", actorIds);

    if (!profileError) {
      names = new Map(
        (profileRows ?? []).map((row) => [row.id, `${row.first_name} ${row.last_name}`.trim()]),
      );
    }
  }

  const items: AuditLogItem[] = rows.map((row) => ({
    ...mapAuditLogRow(row),
    actorName: row.user_id ? (names.get(row.user_id) ?? "Usuario eliminado") : "Usuario eliminado",
  }));

  return { items, total, hasMore: filters.offset + items.length < total };
}

/**
 * Combines the directory projection with the masked emails for the admin
 * users table. The `get_user_emails` RPC re-checks `umsuka.is_admin()`
 * inside the database and fails closed for management roles that only
 * hold `users.read`: in that case the directory still renders with null
 * emails (shown as "—"), never crashing the read-only view.
 */
export async function listUsersOverview(): Promise<AdminUserRow[]> {
  const actor = await requireAuthenticatedProfile();
  requirePermission(actor.role, "users.read");

  const profiles = await listProfiles();
  if (profiles.length === 0) {
    return [];
  }

  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_user_emails", {
    p_user_ids: profiles.map((profile) => profile.id),
  });

  if (error) {
    console.error("listUsersOverview: get_user_emails falló (emails ocultos):", {
      message: error.message,
      code: error.code,
    });
    return profiles.map((profile) => ({ ...profile, email: null }));
  }

  const emails = new Map((data ?? []).map((row) => [row.id, row.email]));
  return profiles.map((profile) => ({ ...profile, email: emails.get(profile.id) ?? null }));
}