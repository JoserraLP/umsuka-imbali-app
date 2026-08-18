"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Bell, CheckCheck, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useMarkAllAsRead,
  useMarkAsRead,
  useRecentNotifications,
  useUnreadCount,
} from "@/lib/notifications/hooks";
import { formatRelativeTime, type NotificationItem } from "@/lib/notifications/schema";
import {
  NotificationTypeIcon,
  NOTIFICATION_TYPE_COLORS,
} from "@/components/notifications/notification-type-icon";

/**
 * Header notification bell (Sprint 20): unread-count badge + dropdown
 * with the 5 latest notifications. Marking an item as read navigates to
 * its link (`/notifications` when none); "Marcar todo como leído" and
 * "Ver todas" are the escape hatches. The dropdown closes on outside
 * click and on navigation.
 */
export function NotificationBell({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const router = useRouter();

  const { data: unreadCount = 0 } = useUnreadCount(userId);
  const { data: notifications = [] } = useRecentNotifications(userId, 5);
  const markAll = useMarkAllAsRead(userId);
  const markRead = useMarkAsRead(userId);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  // Close on navigation.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  const handleItemClick = (notification: NotificationItem) => {
    setOpen(false);
    if (!notification.isRead) {
      markRead.mutate(notification.id);
    }
    router.push(notification.link ?? "/notifications");
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        aria-label={`Notificaciones${unreadCount > 0 ? ` (${unreadCount} sin leer)` : ""}`}
        aria-expanded={open}
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <Card className="absolute right-0 top-full z-40 mt-2 w-80 shadow-lg">
          <CardHeader className="border-b px-4 py-3">
            <CardTitle className="text-sm">Notificaciones</CardTitle>
          </CardHeader>

          <CardContent className="p-0">
            {notifications.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-center">
                <Bell className="mb-2 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No hay notificaciones</p>
              </div>
            ) : (
              <ul className="max-h-80 divide-y divide-border overflow-y-auto" role="list">
                {notifications.map((notification) => (
                  <li key={notification.id}>
                    <button
                      type="button"
                      onClick={() => handleItemClick(notification)}
                      className="flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/50"
                    >
                      <div className={cn("mt-0.5 shrink-0", NOTIFICATION_TYPE_COLORS[notification.type])}>
                        <NotificationTypeIcon type={notification.type} className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p
                          className={cn(
                            "text-sm leading-tight",
                            notification.isRead
                              ? "text-muted-foreground"
                              : "font-semibold text-foreground",
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
                      <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground/50">
                        {formatRelativeTime(notification.createdAt)}
                        <ChevronRight className="h-3 w-3" />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>

          <CardFooter className="flex items-center justify-between border-t px-4 py-2.5">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => markAll.mutate()}
              disabled={markAll.isPending || unreadCount === 0}
              className="gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <CheckCheck className="h-3.5 w-3.5" />
              Marcar todo como leído
            </Button>
            <Link
              href="/notifications"
              className="text-xs font-medium text-primary transition-colors hover:text-primary/80"
            >
              Ver todas
            </Link>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}