"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NotificationsWidget } from "@/components/dashboard/notifications-widget";
import { InstagramPostCard } from "@/components/dashboard/instagram-post-card";
import { SectionHeader } from "@/components/dashboard/section-header";
import { Instagram, CalendarDays } from "lucide-react";
import type { AuthenticatedProfile } from "@/types/auth";
import type { InstagramPost } from "@/lib/social/instagram";
import type { EventListItem } from "@/lib/events/queries";

interface DashboardContentProps {
  profile: AuthenticatedProfile;
  posts: InstagramPost[];
  events: EventListItem[];
  signOutAction: () => void;
}

/**
 * Client component that arranges the dashboard layout with three sections:
 * - Left: Instagram feed grid
 * - Right sidebar: notifications widget stacked on top of calendar widget
 *
 * The layout is responsive: stacks vertically on mobile, 2-column on desktop.
 */

// Event type label mapping
const EVENT_TYPE_LABELS: Record<string, string> = {
  general: "General",
  meeting: "Reunión",
  carnival: "Carnaval",
  work_shift: "Turno",
};

function formatEventDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  // Compute tomorrow using setDate to handle DST transitions safely
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const isTomorrow =
    tomorrow.getDate() === date.getDate() &&
    tomorrow.getMonth() === date.getMonth() &&
    tomorrow.getFullYear() === date.getFullYear();

  const day = date.toLocaleDateString("es-ES", { weekday: "short" });
  const dayNum = date.getDate();
  const month = date.toLocaleDateString("es-ES", { month: "short" });
  const time = date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  const prefix = isToday ? "Hoy" : isTomorrow ? "Mañana" : `${day} ${dayNum} ${month}`;
  return `${prefix} · ${time}`;
}

export function DashboardContent({ profile, posts, events, signOutAction }: DashboardContentProps) {
  return (
    <div className="animate-fade-in space-y-6">
      {/* ── Welcome Banner ──────────────────────────────── */}
      <div className="border-b border-border pb-4">
        <h1 className="text-xl font-bold tracking-tight">
          Bienvenido/a, {profile.firstName}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Panel principal de Umsuka Imbali.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Badge variant="secondary">{profile.role}</Badge>
          <Badge variant="outline">{profile.componentType}</Badge>
        </div>
      </div>

      {/* ── Main Grid: 2 columns on desktop ─────────────── */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
        {/* Left: Instagram Feed */}
        <section className="rounded-xl border bg-card p-5">
          <SectionHeader title="Instagram" icon={Instagram} />

          {posts.length === 0 ? (
            <div className="mt-4 flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-12 text-center">
              <Instagram className="mb-3 h-10 w-10 text-muted-foreground/50" />
              <p className="text-sm text-muted-foreground">
                No hay publicaciones de Instagram disponibles.
              </p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Vuelve más tarde o sigue a @umsuka en Instagram.
              </p>
            </div>
          ) : (
            <>
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {posts.slice(0, 9).map((post) => (
                  <InstagramPostCard key={post.id} post={post} />
                ))}
              </div>
              <p className="mt-4 text-center text-xs text-muted-foreground/60">
                Síguenos en{" "}
                <a
                  href="https://www.instagram.com/umsuka"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  @umsuka
                </a>
              </p>
            </>
          )}
        </section>

        {/* Right sidebar: Notifications + Calendar */}
        <div className="flex flex-col gap-6">
          {/* Notifications */}
          <section className="rounded-xl border bg-card p-5">
            <NotificationsWidget />
          </section>

          {/* Events / Calendar */}
          <section className="rounded-xl border bg-card p-5">
            <SectionHeader
              title="Próximos Eventos"
              icon={CalendarDays}
              action={
                <a
                  href="/events"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Ver todos
                </a>
              }
            />

            {events.length === 0 ? (
              <div className="mt-2 flex flex-col items-center justify-center py-8 text-center">
                <CalendarDays className="mb-2 h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No hay próximos eventos</p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Los eventos programados aparecerán aquí.
                </p>
              </div>
            ) : (
              <ul className="mt-1 divide-y divide-border" role="list">
                {events.slice(0, 5).map((event) => (
                  <li key={event.id}>
                    <a
                      href={`/events/${event.id}`}
                      className="flex items-start justify-between gap-3 px-1 py-3 transition-colors hover:bg-accent/50 rounded-lg"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium leading-tight text-foreground truncate">
                          {event.title}
                        </p>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {formatEventDate(event.eventDate)}
                        </p>
                      </div>
                      <Badge variant="outline" className="shrink-0 text-[10px]">
                        {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
                      </Badge>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* Session info */}
          <section className="rounded-xl border bg-card p-5">
            <div className="flex flex-col gap-3">
              <div>
                <h2 className="text-sm font-semibold">Tu sesión</h2>
                <p className="text-xs text-muted-foreground">{profile.email ?? "correo desconocido"}</p>
              </div>
              <form action={signOutAction}>
                <Button type="submit" variant="outline" size="sm" className="w-full">
                  Cerrar sesión
                </Button>
              </form>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
