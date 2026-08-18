"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Bell, CheckCheck, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { useMarkAllAsRead, useMarkAsRead } from "@/lib/notifications/hooks";
import { loadMoreNotificationsAction } from "@/app/notifications/actions";
import {
  formatRelativeTime,
  NOTIFICATIONS_PAGE_SIZE,
  type NotificationItem,
} from "@/lib/notifications/schema";
import {
  NotificationTypeIcon,
  NOTIFICATION_TYPE_COLORS,
} from "@/components/notifications/notification-type-icon";

/**
 * Full notification history (/notifications): rows grouped into
 * "No leídas" / "Leídas". The server renders the first page
 * (`NOTIFICATIONS_PAGE_SIZE` items) and the client accumulates more pages
 * via `loadMoreNotificationsAction` when the user presses "Cargar más".
 *
 * Marking as read is optimistic: the local list updates immediately and
 * the server action runs in the background (the hooks invalidate the
 * unread-badge queries). The page is deliberately NOT refreshed after
 * marking, because `router.refresh()` would reset the local state and
 * discard the already-loaded pages.
 */
export function NotificationsList({
  userId,
  initialNotifications,
}: {
  userId: string;
  initialNotifications: NotificationItem[];
}) {
  const [notifications, setNotifications] = useState<NotificationItem[]>(initialNotifications);
  const [hasMore, setHasMore] = useState(initialNotifications.length >= NOTIFICATIONS_PAGE_SIZE);
  const [isLoadingMore, startLoadMore] = useTransition();
  const markAsRead = useMarkAsRead(userId);
  const markAll = useMarkAllAsRead(userId);

  const handleLoadMore = () => {
    startLoadMore(async () => {
      const more = await loadMoreNotificationsAction(notifications.length);
      if (more.length < NOTIFICATIONS_PAGE_SIZE) {
        setHasMore(false);
      }
      setNotifications((prev) => [...prev, ...more]);
    });
  };

  const handleMarkRead = (notification: NotificationItem) => {
    if (notification.isRead) return;

    // Optimistic: reflect the read state immediately, revert on failure.
    setNotifications((prev) =>
      prev.map((n) => (n.id === notification.id ? { ...n, isRead: true } : n)),
    );
    markAsRead.mutate(notification.id, {
      onError: () =>
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, isRead: false } : n)),
        ),
    });
  };

  const handleMarkAllRead = () => {
    const snapshot = notifications;
    setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })));
    markAll.mutate(undefined, {
      onError: () => setNotifications(snapshot),
    });
  };

  const unread = notifications.filter((notification) => !notification.isRead);
  const read = notifications.filter((notification) => notification.isRead);

  const renderRow = (notification: NotificationItem) => (
    <li
      key={notification.id}
      className={cn(
        "flex items-start gap-3 px-2 py-3 transition-colors",
        !notification.isRead && "bg-accent/30",
      )}
    >
      <div className={cn("mt-0.5 shrink-0", NOTIFICATION_TYPE_COLORS[notification.type])}>
        <NotificationTypeIcon type={notification.type} className="h-4 w-4" />
      </div>

      <div className="min-w-0 flex-1">
        <Link
          href={notification.link ?? "/notifications"}
          onClick={() => handleMarkRead(notification)}
          className="block rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <p
            className={cn(
              "text-sm leading-tight",
              notification.isRead ? "text-muted-foreground" : "font-semibold text-foreground",
            )}
          >
            {notification.title}
          </p>
          {notification.message && (
            <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground/70">
              {notification.message}
            </p>
          )}
        </Link>
        <p className="mt-1 text-[11px] text-muted-foreground/50">
          {formatRelativeTime(notification.createdAt)}
        </p>
      </div>

      {!notification.isRead && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => handleMarkRead(notification)}
          disabled={markAsRead.isPending}
          className="shrink-0 gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <CheckCheck className="h-3.5 w-3.5" />
          Leída
        </Button>
      )}
    </li>
  );

  return (
    <section>
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">Historial de notificaciones</h2>
        {unread.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={handleMarkAllRead}
            disabled={markAll.isPending}
            className="gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <CheckCheck className="h-3.5 w-3.5" />
            Marcar todas como leídas
          </Button>
        )}
      </div>

      {notifications.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <Bell className="mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No hay notificaciones</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Las novedades de la comparsa aparecerán aquí.
          </p>
        </div>
      ) : (
        <div className="mt-2 space-y-6">
          {unread.length > 0 && (
            <div>
              <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                No leídas ({unread.length})
              </h3>
              <ul className="mt-1 divide-y divide-border rounded-xl border bg-card" role="list">
                {unread.map(renderRow)}
              </ul>
            </div>
          )}

          {read.length > 0 && (
            <div>
              <h3 className="px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Leídas ({read.length})
              </h3>
              <ul className="mt-1 divide-y divide-border rounded-xl border bg-card" role="list">
                {read.map(renderRow)}
              </ul>
            </div>
          )}

          {hasMore && (
            <div className="flex justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                className="gap-1 text-xs"
              >
                <ChevronDown className="h-3.5 w-3.5" />
                {isLoadingMore ? "Cargando…" : "Cargar más"}
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
