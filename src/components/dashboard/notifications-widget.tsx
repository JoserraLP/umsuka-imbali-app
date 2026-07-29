"use client";

import { useState, useCallback } from "react";
import { Bell, Calendar, Clock, Users, Megaphone, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionHeader } from "@/components/dashboard/section-header";
import { Button } from "@/components/ui/button";
import type { LucideIcon } from "lucide-react";

// ── Types ──────────────────────────────────────────────

interface MockNotification {
  id: string;
  icon: LucideIcon;
  iconColor: string;
  title: string;
  description: string;
  time: string;
  read: boolean;
}

// ── Mock Data ──────────────────────────────────────────

function generateMockNotifications(): MockNotification[] {
  return [
    {
      id: "n1",
      icon: Calendar,
      iconColor: "text-blue-500",
      title: "Nuevo evento agendado",
      description: "Ensayo general de carnaval — sábado 15:00 h",
      time: "Hace 2 horas",
      read: false,
    },
    {
      id: "n2",
      icon: Users,
      iconColor: "text-green-500",
      title: "Asignación de turno",
      description: "Te han asignado al turno de barra para el próximo evento",
      time: "Hace 5 horas",
      read: false,
    },
    {
      id: "n3",
      icon: Megaphone,
      iconColor: "text-purple-500",
      title: "Nueva noticia publicada",
      description: "Resultados de la votación de vestuario disponibles",
      time: "Ayer",
      read: false,
    },
    {
      id: "n4",
      icon: Clock,
      iconColor: "text-amber-500",
      title: "Recordatorio de asistencia",
      description: "No olvides confirmar tu asistencia al evento del viernes",
      time: "Ayer",
      read: true,
    },
    {
      id: "n5",
      icon: Calendar,
      iconColor: "text-blue-500",
      title: "Evento modificado",
      description: "Cambio de horario: Taller de percusión pasa a las 17:00 h",
      time: "Hace 2 días",
      read: true,
    },
    {
      id: "n6",
      icon: Users,
      iconColor: "text-green-500",
      title: "Solicitud de ausencia",
      description: "Tu solicitud de ausencia para el ensayo ha sido aprobada",
      time: "Hace 3 días",
      read: true,
    },
  ];
}

// ── Helpers ─────────────────────────────────────────────

function timeAgo(date: string): string {
  return date; // already formatted in mock data
}

// ── Component ──────────────────────────────────────────

/**
 * Notifications widget that displays the last 5 unread notifications.
 *
 * Uses mock data by default (Sprint 15 will replace with real data from
 * the umsuka.notifications table). "Mark all as read" is a client-side
 * local state operation.
 */
export function NotificationsWidget() {
  const [notifications, setNotifications] = useState<MockNotification[]>(
    () => generateMockNotifications(),
  );

  const unreadCount = notifications.filter((n) => !n.read).length;

  const handleMarkAllRead = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  }, []);

  const visibleNotifications = notifications.slice(0, 5);

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
              onClick={handleMarkAllRead}
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

        {visibleNotifications.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 text-center">
            <Bell className="mb-2 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No hay notificaciones</p>
          </div>
        ) : (
          <ul className="divide-y divide-border" role="list">
            {visibleNotifications.map((notification) => (
              <li
                key={notification.id}
                className={cn(
                  "flex items-start gap-3 px-2 py-3 transition-colors",
                  !notification.read && "bg-accent/30",
                )}
              >
                <div className={cn("mt-0.5 shrink-0", notification.iconColor)}>
                  <notification.icon className="h-4 w-4" aria-hidden="true" />
                </div>
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "text-sm leading-tight",
                      !notification.read ? "font-semibold text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {notification.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground/70 line-clamp-1">
                    {notification.description}
                  </p>
                </div>
                <span className="shrink-0 text-[11px] text-muted-foreground/50">
                  {notification.time}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
