"use client";

import { useNotificationsRealtime } from "@/lib/notifications/hooks";

/**
 * Mounts the Realtime subscription for the signed-in user exactly once
 * per app shell render (desktop sidebar and mobile bottom nav both live
 * here), so the unread badge/recent lists update in live without each
 * consumer (bell, widget, /notifications list) opening its own channel.
 * Renders nothing.
 */
export function NotificationsRealtime({ userId }: { userId: string }) {
  useNotificationsRealtime(userId);
  return null;
}