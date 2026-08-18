import { z } from "zod";
import type { Database, Json } from "@/types/database.types";

/**
 * Isomorphic (client-safe) admin-panel constants, zod schemas and pure
 * mappers (Sprint 21).
 *
 * IMPORTANT: this module must stay free of server-only imports
 * (`next/headers`, supabase clients, `@/lib/auth/session`, `server-only`)
 * because client components (`settings-form`, `audit-log-view`,
 * `user-status-actions`) import it directly.
 */

// ── Constants + types ───────────────────────────────────

/** Known global setting keys (mirrors the seed in migration 0053). */
export const SETTING_KEYS = ["app_name", "instagram_url"] as const;
export type SettingKey = (typeof SETTING_KEYS)[number];

export const SETTING_KEY_LABELS: Record<SettingKey, string> = {
  app_name: "Nombre de la asociación",
  instagram_url: "URL de Instagram",
};

/**
 * The 13 audited administrative actions (mirrors the CHECK constraint
 * `chk_audit_logs_action` in migration 0053).
 */
export const AUDIT_ACTIONS = [
  "user.role_changed",
  "user.activated",
  "user.deactivated",
  "user.approved",
  "user.suspended",
  "user.profile_updated",
  "user.component_type_changed",
  "user.workgroup_changed",
  "user.component_lead_changed",
  "user.emailless_created",
  "user.password_reset_generated",
  "user.account_unlocked",
  "settings.updated",
] as const;
export type AdminAuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_ACTION_LABELS: Record<AdminAuditAction, string> = {
  "user.role_changed": "Rol cambiado",
  "user.activated": "Alta de cuenta",
  "user.deactivated": "Baja de cuenta",
  "user.approved": "Cuenta aprobada",
  "user.suspended": "Cuenta suspendida",
  "user.profile_updated": "Perfil actualizado",
  "user.component_type_changed": "Componente cambiado",
  "user.workgroup_changed": "Grupo de trabajo cambiado",
  "user.component_lead_changed": "Responsable de componente cambiado",
  "user.emailless_created": "Cuenta sin email creada",
  "user.password_reset_generated": "Reset de contraseña generado",
  "user.account_unlocked": "Cuenta desbloqueada",
  "settings.updated": "Configuración actualizada",
};

/** Page size for /admin/audit. The server loads one page per request. */
export const AUDIT_PAGE_SIZE = 50;

// ── Zod schemas ─────────────────────────────────────────

/**
 * Update of a global setting. Key must be a known setting key; the value
 * is trimmed and capped at 300 chars (stricter than the 500-char DB
 * CHECK). app_name is mandatory (cannot be cleared); instagram_url may
 * be cleared to remove the link.
 */
export const updateSettingSchema = z
  .object({
    key: z.enum(SETTING_KEYS, {
      errorMap: () => ({ message: "Clave de configuración no válida." }),
    }),
    value: z
      .string()
      .trim()
      .max(300, "El valor debe tener 300 caracteres o menos."),
  })
  .refine((data) => data.key !== "app_name" || data.value.length > 0, {
    message: "El nombre de la app no puede estar vacío.",
    path: ["value"],
  });
export type UpdateSettingInput = z.infer<typeof updateSettingSchema>;

/**
 * One audit_logs row (append-only). Mirrors the DB CHECK constraints of
 * umsuka.audit_logs (action whitelist, entity_type <= 100, entity_id
 * null or <= 200). `details` accepts any JSON-serializable object;
 * null/undefined are normalized to null.
 */
export const logAuditActionSchema = z.object({
  actorId: z.string().uuid("El actor debe ser un UUID válido."),
  action: z.enum(AUDIT_ACTIONS, {
    errorMap: () => ({ message: "Acción de auditoría no válida." }),
  }),
  entityType: z
    .string()
    .trim()
    .min(1, "El tipo de entidad es obligatorio.")
    .max(100, "El tipo de entidad debe tener 100 caracteres o menos."),
  entityId: z
    .string()
    .trim()
    .max(200, "El id de entidad debe tener 200 caracteres o menos.")
    .nullable()
    .optional()
    .transform((value) => (value ? value : null)),
  details: z
    .record(z.string(), z.unknown())
    .nullable()
    .optional()
    .transform((value) => value ?? null),
});
/**
 * LogAuditInput is the INPUT type of the audit schema (z.input): the
 * optional fields (entityId, details) stay optional for callers —
 * logAuditAction normalizes them to null at parse time, so the output
 * shape is only visible inside the mutation module.
 */
export type LogAuditInput = z.input<typeof logAuditActionSchema>;

function toEndOfDayUtc(dateOnly: string): string {
  return new Date(`${dateOnly}T23:59:59.999Z`).toISOString();
}

/**
 * Filters + pagination for /admin/audit, parsed from URL searchParams.
 * `user`/`action`/`from`/`to` are kept as-is (empty strings →
 * undefined); `to` stays RAW (YYYY-MM-DD) so the audit-log-view can
 * re-inject it into pagination/filter URLs and the schema can re-parse
 * it (round-trip safe, M1 regression). `toEndOfDay` is DERIVED at parse
 * time as end-of-day UTC and used ONLY by the query layer for the `.lte`
 * clause — it never reaches the URL.
 *
 * NOTE on timezones (m7): end-of-day is computed in UTC, so for users in
 * negative offsets (e.g. America) the last day of the range loses the
 * hours between 00:00 local and 00:00 UTC when filtering by `to`. This
 * is a documented, accepted limitation; the filter is a coarse
 * day-level convenience, not an exact boundary.
 */
export interface AuditLogFilters {
  user?: string;
  action?: (typeof AUDIT_ACTIONS)[number];
  from?: string;
  /** Raw YYYY-MM-DD — page-safe value that can be re-injected into URLs. */
  to?: string;
  page: number;
  offset: number;
  /** End-of-day UTC of `to`, derived at parse time (query layer only). */
  toEndOfDay?: string;
}

export const auditLogFiltersSchema = z
  .object({
    user: z
      .string()
      .uuid("El filtro de usuario debe ser un UUID válido.")
      .optional()
      .or(z.literal(""))
      .transform((value) => (value ? value : undefined)),
    action: z
      .enum(AUDIT_ACTIONS, {
        errorMap: () => ({ message: "Acción de auditoría no válida." }),
      })
      .optional()
      .or(z.literal(""))
      .transform((value) => (value ? value : undefined)),
    from: z
      .string()
      .date("La fecha inicial debe tener formato YYYY-MM-DD.")
      .optional()
      .or(z.literal(""))
      .transform((value) => (value ? value : undefined)),
    to: z
      .string()
      .date("La fecha final debe tener formato YYYY-MM-DD.")
      .optional()
      .or(z.literal(""))
      .transform((value) => (value ? value : undefined)),
    page: z.coerce
      .number()
      .int("La página debe ser un número entero.")
      .min(1, "La página debe ser al menos 1.")
      .default(1),
  })
  .transform(
    (data): AuditLogFilters => ({
      ...data,
      toEndOfDay: data.to ? toEndOfDayUtc(data.to) : undefined,
      offset: (data.page - 1) * AUDIT_PAGE_SIZE,
    }),
  );

// ── Pure mappers ────────────────────────────────────────

export interface SettingsItem {
  key: string;
  value: string;
  updatedBy: string | null;
  updatedAt: string;
}

export interface AuditLogItem {
  id: string;
  userId: string | null;
  /** Resolved actor display name; set by the query layer. */
  actorName: string;
  action: AdminAuditAction;
  entityType: string;
  entityId: string | null;
  details: Json | null;
  createdAt: string;
}

type SettingsRow = Database["umsuka"]["Tables"]["settings"]["Row"];
type AuditLogRow = Database["umsuka"]["Tables"]["audit_logs"]["Row"];

/** Maps a DB settings row to the camelCase shape used by the UI. */
export function mapSettingsRow(row: SettingsRow): SettingsItem {
  return {
    key: row.key,
    value: row.value,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at,
  };
}

/**
 * Maps a DB audit_logs row to the camelCase UI shape WITHOUT the actor
 * display name — the query layer resolves the profile names and fills
 * `actorName` (see src/lib/admin/queries.ts listAuditLogs).
 */
export function mapAuditLogRow(
  row: AuditLogRow,
): Omit<AuditLogItem, "actorName"> & { action: AdminAuditAction } {
  return {
    id: row.id,
    userId: row.user_id,
    // The DB CHECK chk_audit_logs_action guarantees the 13-value set.
    action: row.action as AdminAuditAction,
    entityType: row.entity_type,
    entityId: row.entity_id,
    details: row.details,
    createdAt: row.created_at,
  };
}