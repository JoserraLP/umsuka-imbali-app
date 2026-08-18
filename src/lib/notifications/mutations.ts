import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import {
  createNotificationSchema,
  updateNotificationPreferencesSchema,
  type CreateNotificationInput,
} from "@/lib/notifications/schema";
import type { NotificationType } from "@/types/database.types";

export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
}

/**
 * Server-side notification mutations (Sprint 20).
 *
 * SECURITY: `markAsRead` / `markAllAsRead` / `updateNotificationPreferences`
 * scope every write to the authenticated actor's own id (double-scoped
 * `.eq("id", ...).eq("user_id", actor.id)`), mirroring the own-row RLS
 * policies — the actor can never touch another user's rows even if the
 * input is tampered with. `createNotification` is the privileged path
 * used by other modules' emit layer (service role, bypasses RLS): it must
 * ONLY ever be called with recipient ids resolved server-side, never from
 * client input (see `src/lib/notifications/emit.ts`).
 */

/**
 * Marks a single notification as read. The notification id must belong
 * to the authenticated actor (doble scoping); a foreign or missing id
 * silently updates zero rows and still reports success — the UI simply
 * refreshes to the real state.
 */
export async function markAsRead(notificationId: string): Promise<MutationResult> {
  const actor = await requireAuthenticatedProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("id", notificationId)
    .eq("user_id", actor.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Marks every unread notification of the authenticated actor as read.
 */
export async function markAllAsRead(): Promise<MutationResult> {
  const actor = await requireAuthenticatedProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", actor.id)
    .eq("is_read", false);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Replaces the authenticated actor's notification preferences (upsert).
 * `types: []` means "receive every type" (documented storage semantic);
 * a non-empty array opts out of every type not listed.
 */
export async function updateNotificationPreferences(
  types: NotificationType[],
): Promise<MutationResult> {
  const parsed = updateNotificationPreferencesSchema.safeParse({ types });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("notification_preferences")
    .upsert({ user_id: actor.id, types: parsed.data.types }, { onConflict: "user_id" });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Creates a notification row through the privileged (service role)
 * client, bypassing RLS.
 *
 * SECURITY: this function must NOT be callable with user-controlled
 * recipient ids — only the emit layer (`src/lib/notifications/emit.ts`)
 * and other trusted server modules should call it, always with ids
 * resolved from the database (audience resolution, active members, the
 * assigned member). The `server-only` import chain in
 * `src/lib/supabase/admin.ts` guarantees a build-time failure if this
 * module is ever pulled into a Client Component bundle.
 */
export async function createNotification(input: CreateNotificationInput): Promise<MutationResult> {
  const parsed = createNotificationSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const admin = createAdminClient();

  const { data, error } = await admin
    .from("notifications")
    .insert({
      user_id: parsed.data.user_id,
      title: parsed.data.title,
      message: parsed.data.message,
      type: parsed.data.type,
      link: parsed.data.link,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, id: data.id };
}