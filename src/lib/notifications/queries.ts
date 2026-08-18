import { createClient } from "@/lib/supabase/server";
import {
  mapNotificationRow,
  mapPreferenceRow,
  type NotificationItem,
  type NotificationPreferenceItem,
} from "@/lib/notifications/schema";

/**
 * Server-side notification queries (Sprint 20): always scoped to the
 * requesting user id — callers receive the user id from their own
 * session (`getCurrentProfile()`), never from client input.
 *
 * SECURITY: every query filters by `user_id`, which mirrors the
 * notifications_*_own / preferences_*_own RLS policies exactly (a user
 * can only ever read their own rows). The server layer re-checks the
 * session before calling these functions, and RLS remains the backstop
 * if a caller ever forgets.
 */

/**
 * Returns the user's notifications, newest first, with simple
 * limit/offset pagination. Mapped to the camelCase UI shape.
 */
export async function getMyNotifications(
  userId: string,
  { limit = 50, offset = 0 }: { limit?: number; offset?: number } = {},
): Promise<NotificationItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notifications")
    .select("id, user_id, title, message, type, is_read, link, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    throw new Error(`Error al obtener notificaciones: ${error.message}`);
  }

  return (data ?? []).map(mapNotificationRow);
}

/**
 * Number of unread notifications for the user. Count-only query
 * (`head: true`); falls back to 0 on error so the header badge never
 * crashes the UI when the count cannot be resolved.
 */
export async function getUnreadCount(userId: string): Promise<number> {
  const supabase = await createClient();

  const { count, error } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);

  if (error) {
    console.error("getUnreadCount: no se pudo obtener el contador de no leídas:", {
      message: error.message,
      code: error.code,
    });
    return 0;
  }

  return count ?? 0;
}

/**
 * Returns the user's notification preferences. A missing row (legacy
 * account created before migration 0052) is treated as `{ types: [] }` —
 * the documented "receive everything" default — so the UI can always
 * render a coherent state.
 */
export async function getMyNotificationPreferences(
  userId: string,
): Promise<NotificationPreferenceItem> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("notification_preferences")
    .select("user_id, types")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al obtener preferencias de notificación: ${error.message}`);
  }

  if (!data) {
    return { userId, types: [] };
  }

  return mapPreferenceRow(data);
}