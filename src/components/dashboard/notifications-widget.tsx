"use client";

import { Bell, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/dashboard/section-header";
import { Button } from "@/components/ui/button";
import {
  useMarkAllAsRead,
  useRecentNotifications,
  useUnreadCount,
} from "@/lib/notifications/hooks";
import { formatRelativeTime } from "@/lib/notifications/schema";
import {
  NotificationTypeIcon,
  NOTIFICATION_TYPE_COLORS,
} from "@/components/notifications/notification-type-icon";

/**
 * Dashboard notifications widget (Sprint 20): the 5 latest notifications
 * from umsuka.notifications with the unread badge and a "mark all as
 * read" action backed by the server action. Layout mirrors the previous
 * mock widget.
 */
export function NotificationsWidget({ userId }: { userId: string }) {
  const { data: notifications = [] } = useRecentNotifications(userId, 5);
  const { data: unreadCount = 0 } = useUnreadCount(userId);
  const markAll = useMarkAllAsRead(userId);

  return (
    <section>
      <SectionHeader
        title="Notificaciones"
        icon={Bell}
        action={
          unreadCount > 0 ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="mr-1 h-3.5 w-3.5" />
              Marcar todas leídas
            </Button>
          ) : undefined
        }
      />

      <div className="mt-1">
        {unreadCount > 0 && (
          <div className="mb-2 flex items-center gap-2 px-2">
            <div className="flex h-5 items-center justify-center rounded-full bg-primary px-2 text-[10px] font-semibold text-primary-foreground">
              {unreadCount} {unreadCount === 1 ? "nueva" : "nuevas"}
            </div>
          </div>
        )}

        {notifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Bell className="mb-2 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No hay notificaciones</p>
          </div>
        ) : (
          <ul className="divide-y divide-border" role="list">
            {notifications.map((notification) => (
              <li
                key={notification.id}
                className={cn(
                  "flex items-start gap-3 px-2 py-3 transition-colors",
                  !notification.isRead && "bg-accent/30",
                )}
              >
                <div
                  className={cn(
                    "mt-0.5 shrink-0",
                    NOTIFICATION_TYPE_COLORS[notification.type],
                  )}
                >
                  <NotificationTypeIcon type={notification.type} className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm leading-tight",
                      !notification.isRead
                        ? "font-semibold text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {notification.title}
                  </p>
                  {notification.message && (
                    <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground/70">
                      {notification.message}
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground/50">
                  {formatRelativeTime(notification.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}