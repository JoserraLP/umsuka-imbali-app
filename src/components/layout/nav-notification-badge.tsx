"use client";

import type { ReactNode } from "react";
import { useUnreadCount } from "@/lib/notifications/hooks";

/**
 * Micro-badge shown over the "Notificaciones" nav item (sidebar +
 * bottom nav) with the unread count. Renders nothing when there is
 * nothing unread.
 */
export function NavNotificationBadge({
  userId,
  children,
}: {
  userId: string;
  children: ReactNode;
}) {
  const { data: unreadCount = 0 } = useUnreadCount(userId);

  return (
    <span className="relative inline-flex">
      {children}
      {unreadCount > 0 && (
        <span className="absolute -right-2.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
          {unreadCount > 99 ? "99+" : unreadCount}
        </span>
      )}
    </span>
  );
}