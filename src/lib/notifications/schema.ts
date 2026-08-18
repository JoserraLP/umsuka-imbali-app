import { z } from "zod";
import type { NotificationType } from "@/types/database.types";
import type { Database } from "@/types/database.types";

/**
 * Isomorphic (client-safe) notifications constants, zod schemas, pure
 * mappers and time formatting (Sprint 20).
 *
 * IMPORTANT: this module must stay free of server-only imports
 * (`next/headers`, supabase clients, `@/lib/auth/session`, `server-only`)
 * because client components (`notification-bell`, `notifications-list`,
 * `notification-preferences-card`, and the hooks in `./hooks.ts`) import
 * it directly.
 */

// ── Constants + types ───────────────────────────────────

export const NOTIFICATION_TYPES = [
  "event_created",
  "news_created",
  "voting_created",
  "shift_assigned",
  "profile_approved",
] as const satisfies readonly NotificationType[];

/**
 * Page size for the /notifications history list. The server page loads
 * the first page and `loadMoreNotificationsAction` fetches subsequent
 * pages of the same size (see src/app/notifications/actions.ts).
 */
export const NOTIFICATIONS_PAGE_SIZE = 50;

export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  event_created: "Nuevo evento",
  news_created: "Nueva noticia",
  voting_created: "Nueva votación",
  shift_assigned: "Turno asignado",
  profile_approved: "Cuenta aprobada",
};

export function isNotificationType(value: unknown): value is NotificationType {
  return typeof value === "string" && (NOTIFICATION_TYPES as readonly string[]).includes(value);
}

// ── Zod schemas ─────────────────────────────────────────

/**
 * Server-side creation schema for a single notification row. Used by
 * `createNotification` (lib) and mirrored by the SQL CHECK constraints
 * of umsuka.notifications (defense in depth).
 */
export const createNotificationSchema = z.object({
  user_id: z.string().uuid("El usuario debe ser un UUID válido."),
  title: z
    .string()
    .trim()
    .min(1, "El título es obligatorio.")
    .max(200, "El título debe tener 200 caracteres o menos."),
  message: z
    .string()
    .trim()
    .max(1000, "El mensaje debe tener 1000 caracteres o menos.")
    .nullable()
    .optional()
    .transform((value) => (value ? value : null)),
  type: z.enum(NOTIFICATION_TYPES, {
    errorMap: () => ({ message: "Tipo de notificación no válido." }),
  }),
  link: z
    .string()
    .trim()
    .max(2048, "El enlace debe tener 2048 caracteres o menos.")
    .nullable()
    .optional()
    .transform((value) => (value ? value : null)),
});
export type CreateNotificationInput = z.infer<typeof createNotificationSchema>;

/**
 * Preferences update schema. Stored semantic: `[]` (empty array) means
 * "receive every notification type"; a non-empty array opts OUT of every
 * type not listed. Duplicates are removed, and the array is capped at the
 * total number of known types (the DB has no CHECK for this, so the
 * application enforces it).
 */
export const updateNotificationPreferencesSchema = z.object({
  types: z
    .array(
      z.enum(NOTIFICATION_TYPES, {
        errorMap: () => ({ message: "Tipo de notificación no válido." }),
      }),
    )
    .max(NOTIFICATION_TYPES.length, "No puedes seleccionar más tipos de los disponibles.")
    .transform((types) => [...new Set(types)]),
});
export type UpdateNotificationPreferencesInput = z.infer<
  typeof updateNotificationPreferencesSchema
>;

// ── Pure mappers ────────────────────────────────────────

export interface NotificationItem {
  id: string;
  userId: string;
  title: string;
  message: string | null;
  type: NotificationType;
  isRead: boolean;
  link: string | null;
  createdAt: string;
}

export interface NotificationPreferenceItem {
  userId: string;
  types: NotificationType[];
}

type NotificationRow = Database["umsuka"]["Tables"]["notifications"]["Row"];
type NotificationPreferenceRow = Database["umsuka"]["Tables"]["notification_preferences"]["Row"];

/** Maps a DB notification row to the camelCase shape used by the UI. */
export function mapNotificationRow(row: NotificationRow): NotificationItem {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    message: row.message,
    type: row.type,
    isRead: row.is_read,
    link: row.link,
    createdAt: row.created_at,
  };
}

/** Maps a DB preference row to the camelCase shape used by the UI. */
export function mapPreferenceRow(row: NotificationPreferenceRow): NotificationPreferenceItem {
  return {
    userId: row.user_id,
    types: row.types,
  };
}

// ── Relative time ───────────────────────────────────────

/**
 * Formats an ISO timestamp as a short relative label: "ahora",
 * "hace X min", "hace X h", "ayer", or the short locale date for older
 * items. Returns "" for unparseable input (defensive; DB rows always
 * carry a valid timestamptz).
 *
 * Calendar-day comparisons (the "hace X h" vs "ayer" boundary) use UTC
 * so the output is deterministic regardless of the runner's timezone.
 */
export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  if (diffMs < 60_000) return "ahora";

  const diffMinutes = Math.floor(diffMs / 60_000);
  if (diffMinutes < 60) return `hace ${diffMinutes} min`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (isSameUtcDay(date, now)) return `hace ${diffHours} h`;

  const yesterday = new Date(now);
  yesterday.setUTCDate(now.getUTCDate() - 1);
  if (isSameUtcDay(date, yesterday)) return "ayer";

  const day = String(date.getUTCDate()).padStart(2, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getUTCFullYear()}`;
}

function isSameUtcDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}
