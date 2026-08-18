"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getCurrentProfile } from "@/lib/auth/session";
import {
  markAsRead,
  markAllAsRead,
  updateNotificationPreferences,
} from "@/lib/notifications/mutations";
import { getMyNotifications } from "@/lib/notifications/queries";
import { NOTIFICATIONS_PAGE_SIZE, type NotificationItem } from "@/lib/notifications/schema";
import type { MutationResult } from "@/lib/notifications/mutations";
import type { NotificationType } from "@/types/database.types";

/**
 * Thin server-action wrappers (Sprint 20). All authorization lives in
 * the resolvers (`requireAuthenticatedProfile` + own-row scoping); the
 * inputs are validated by zod inside those resolvers.
 */

export async function markNotificationReadAction(notificationId: string): Promise<MutationResult> {
  const result = await markAsRead(notificationId);

  if (result.success) {
    revalidatePath("/notifications");
  }

  return result;
}

export async function markAllNotificationsReadAction(): Promise<MutationResult> {
  const result = await markAllAsRead();

  if (result.success) {
    revalidatePath("/notifications");
  }

  return result;
}

export async function updateNotificationPreferencesAction(
  types: NotificationType[],
): Promise<MutationResult> {
  const result = await updateNotificationPreferences(types);

  if (result.success) {
    revalidatePath("/notifications");
  }

  return result;
}

/**
 * Next page of the notification history for the signed-in user
 * ("Cargar más" button). The user id is resolved server-side from the
 * session (never from client input); the offset is validated as a
 * non-negative integer with a reasonable cap so a malformed client can
 * never scan the whole table.
 */
const loadMoreOffsetSchema = z.object({
  offset: z
    .number()
    .int("El desplazamiento debe ser un número entero.")
    .min(0, "El desplazamiento debe ser un número positivo.")
    .max(5000, "El desplazamiento supera el límite permitido."),
});

export async function loadMoreNotificationsAction(offset: number): Promise<NotificationItem[]> {
  const parsed = loadMoreOffsetSchema.safeParse({ offset });
  if (!parsed.success) {
    throw new Error(parsed.error.issues.map((issue) => issue.message).join(", "));
  }

  const profile = await getCurrentProfile();
  if (!profile) {
    throw new Error("Se requiere autenticación.");
  }

  return getMyNotifications(profile.id, {
    limit: NOTIFICATIONS_PAGE_SIZE,
    offset: parsed.data.offset,
  });
}
