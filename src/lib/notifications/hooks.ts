"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { mapNotificationRow, type NotificationItem } from "@/lib/notifications/schema";
import {
  markAllNotificationsReadAction,
  markNotificationReadAction,
} from "@/app/notifications/actions";

/**
 * Client-side notification data hooks (Sprint 20): TanStack Query queries
 * against the browser Supabase client (RLS own-row policies gate every
 * read to the signed-in user) plus a per-user Realtime subscription that
 * keeps the header badge and lists in sync while the app is open.
 */

export const UNREAD_KEY = ["notifications", "unreadCount"] as const;
export const RECENT_KEY = ["notifications", "recent"] as const;

/**
 * Unread notifications count for the header badge. Never rejects: a
 * failed query resolves to 0 so the badge simply disappears.
 */
export function useUnreadCount(userId: string) {
  return useQuery({
    queryKey: [...UNREAD_KEY, userId],
    queryFn: async () => {
      const supabase = createClient();
      const { count, error } = await supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("is_read", false);
      return error ? 0 : (count ?? 0);
    },
  });
}

/**
 * Latest `limit` notifications (newest first), mapped to the camelCase
 * UI shape.
 */
export function useRecentNotifications(userId: string, limit = 5) {
  return useQuery({
    queryKey: [...RECENT_KEY, userId, limit],
    queryFn: async (): Promise<NotificationItem[]> => {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("notifications")
        .select("id, user_id, title, message, type, is_read, link, created_at")
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error) {
        throw new Error(`Error al obtener notificaciones: ${error.message}`);
      }

      return (data ?? []).map(mapNotificationRow);
    },
  });
}

/**
 * "Mark all as read" mutation that invalidates both the unread count and
 * the recent list after a successful server action.
 */
export function useMarkAllAsRead(userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markAllNotificationsReadAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...UNREAD_KEY, userId] });
      queryClient.invalidateQueries({ queryKey: [...RECENT_KEY, userId] });
    },
  });
}

/**
 * "Mark one notification as read" mutation that invalidates both the
 * unread count and the recent list after a successful server action.
 */
export function useMarkAsRead(userId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: markNotificationReadAction,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [...UNREAD_KEY, userId] });
      queryClient.invalidateQueries({ queryKey: [...RECENT_KEY, userId] });
    },
  });
}

/**
 * Subscribes to Realtime changes of the user's own notifications
 * (channel `notifications:<userId>`, row filter `user_id=eq.<userId>`).
 * Every change invalidates the unread count and the recent list.
 *
 * Failure behavior: subscription errors are only logged via
 * `console.warn` — the UI keeps working with refetched data (live updates
 * come from this Realtime channel; TanStack's `staleTime` in
 * `query-provider` only controls whether a refetch reuses the cache,
 * there is no periodic refetch interval). The channel
 * is removed on unmount; a ref guard prevents double subscription within
 * the same effect lifetime (e.g. accidental re-renders before cleanup).
 */
export function useNotificationsRealtime(userId: string) {
  const queryClient = useQueryClient();
  const channelRef = useRef<RealtimeChannel | null>(null);
  const subscribedRef = useRef(false);

  useEffect(() => {
    if (!userId || subscribedRef.current) return;
    subscribedRef.current = true;

    const supabase = createClient();
    const channelName = `notifications:${userId}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "umsuka",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: UNREAD_KEY });
          queryClient.invalidateQueries({ queryKey: RECENT_KEY });
        },
      )
      .subscribe((status) => {
        if (status === "CLOSED" || status === "CHANNEL_ERROR") {
          console.warn(
            `useNotificationsRealtime: canal ${channelName} no disponible (${status}) — ` +
              "el contador y la lista se mantendrán al día con las refetch normales.",
          );
        }
      });

    channelRef.current = channel;

    return () => {
      subscribedRef.current = false;
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);
}
