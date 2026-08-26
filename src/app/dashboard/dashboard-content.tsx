"use client";

import Image from "next/image";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { NotificationsWidget } from "@/components/dashboard/notifications-widget";
import { SectionHeader } from "@/components/dashboard/section-header";
import { Instagram, CalendarDays, Newspaper, ExternalLink, Users, Image as ImageIcon, Heart, Plane, Music2, ArrowRight } from "lucide-react";
import type { AuthenticatedProfile } from "@/types/auth";
import type { InstagramProfile } from "@/lib/social/instagram";
import type { EventListItem } from "@/lib/events/queries";
import type { NewsItem } from "@/lib/news/queries";

interface DashboardContentProps {
  profile: AuthenticatedProfile;
  instagramProfile: InstagramProfile;
  events: EventListItem[];
  latestNews: NewsItem[];
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
  rehearsal: "Ensayo",
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

function compactNumber(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1).replace(".0", "") + "M";
  if (n >= 1_000) return (n / 1_000).toFixed(1).replace(".0", "") + "K";
  return String(n);
}

export function DashboardContent({ profile, instagramProfile, events, latestNews, signOutAction }: DashboardContentProps) {
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

      {/* ── Formaciones (Sprint 33) ─── destacado arriba para visibilidad ─ */}
      <section className="rounded-xl border-2 border-primary/20 bg-card p-5 shadow-sm">
        <SectionHeader
          title="Formaciones"
          icon={Plane}
          action={
            <Link href="/formation" className="text-xs text-primary hover:text-primary/80 transition-colors inline-flex items-center gap-1 font-medium">
              {["super_admin","admin","board_member","event_manager"].includes(profile.role) ? "Gestionar" : "Ver"} <ArrowRight className="h-3 w-3" />
            </Link>
          }
        />
        <p className="mt-2 text-xs text-muted-foreground">
          Plano de bailarinas (6 por fila tipo avión 3+pasillo+3) e instrumentos de músicos. {["super_admin","admin","board_member","event_manager"].includes(profile.role) ? "Crea formaciones, asigna bailarinas a asientos y asigna instrumentos." : "Consulta las formaciones publicadas."}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Link href="/formation" className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors shadow">
            <Plane className="h-3.5 w-3.5" />
            {["super_admin","admin","board_member","event_manager"].includes(profile.role) ? "Gestionar formaciones" : "Ver formaciones"}
          </Link>
          <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <Music2 className="h-3 w-3" /> Músicos con instrumento por formación
          </span>
        </div>
      </section>

      {/* ── Instagram Profile — full width above the grid ── */}
      <section className="rounded-xl border bg-card p-5">
        <SectionHeader title="Instagram" icon={Instagram} />

        <div className="mt-4 flex flex-col items-center gap-3 sm:flex-row sm:items-start">
          {/* Avatar */}
          <div className="flex h-20 w-20 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-purple-500 via-pink-500 to-orange-400 p-[3px]">
            {instagramProfile.profilePictureUrl ? (
              <Image
                src={instagramProfile.profilePictureUrl}
                alt={instagramProfile.fullName}
                width={80}
                height={80}
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              <div className="flex h-full w-full items-center justify-center rounded-full bg-card text-xl font-bold text-foreground">
                {instagramProfile.fullName
                  .split(" ")
                  .map((w) => w[0])
                  .join("")
                  .slice(0, 2)}
              </div>
            )}
          </div>

          {/* Info */}
          <div className="flex flex-col items-center text-center sm:items-start sm:text-left">
            <h3 className="text-base font-semibold">{instagramProfile.fullName}</h3>
            <a
              href={instagramProfile.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-muted-foreground hover:text-primary transition-colors"
            >
              @{instagramProfile.username}
            </a>

            {/* Biography — only when real data */}
            {instagramProfile.biography && (
              <p className="mt-1 max-w-md text-xs text-muted-foreground/80 whitespace-pre-line leading-relaxed">
                {instagramProfile.biography}
              </p>
            )}

            {/* Stats — only when real data (count > 0) */}
            {(instagramProfile.postsCount > 0 ||
              instagramProfile.followersCount > 0 ||
              instagramProfile.followingCount > 0) && (
              <div className="mt-3 flex items-center gap-4 text-xs text-muted-foreground">
                {instagramProfile.postsCount > 0 && (
                  <span className="flex items-center gap-1">
                    <ImageIcon className="h-3.5 w-3.5" />
                    <strong className="text-foreground">{compactNumber(instagramProfile.postsCount)}</strong> posts
                  </span>
                )}
                {instagramProfile.followersCount > 0 && (
                  <span className="flex items-center gap-1">
                    <Users className="h-3.5 w-3.5" />
                    <strong className="text-foreground">{compactNumber(instagramProfile.followersCount)}</strong>{" "}
                    seguidores
                  </span>
                )}
                {instagramProfile.followingCount > 0 && (
                  <span className="flex items-center gap-1">
                    <Heart className="h-3.5 w-3.5" />
                    <strong className="text-foreground">{compactNumber(instagramProfile.followingCount)}</strong>{" "}
                    siguiendo
                  </span>
                )}
              </div>
            )}

            {/* Follow button */}
            <a
              href={instagramProfile.externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600 px-4 py-1.5 text-xs font-medium text-white hover:from-purple-500 hover:to-pink-500 transition-all"
            >
              <Instagram className="h-3.5 w-3.5" />
              Seguir en Instagram
              <ExternalLink className="h-3 w-3" />
            </a>
          </div>
        </div>
      </section>

      {/* ── Latest News ──────────────────────────────────── */}
      <section className="rounded-xl border bg-card p-5">
        <SectionHeader
          title="Últimas Noticias"
          icon={Newspaper}
          action={
            <Link
              href="/news"
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Ver todas
            </Link>
          }
        />

        {latestNews.length === 0 ? (
          <div className="mt-2 flex flex-col items-center justify-center py-8 text-center">
            <Newspaper className="mb-2 h-8 w-8 text-muted-foreground/40" />
            <p className="text-sm text-muted-foreground">No hay noticias recientes</p>
            <p className="mt-1 text-xs text-muted-foreground/60">
              Las noticias publicadas aparecerán aquí.
            </p>
          </div>
        ) : (
          <div className="mt-1 divide-y divide-border" role="list">
            {latestNews.map((item) => (
              <div key={item.id}>
                <Link
                  href={`/news/${item.id}`}
                  className="flex flex-col gap-1 px-1 py-3 transition-colors hover:bg-accent/50 rounded-lg"
                >
                  <p className="text-sm font-medium leading-tight text-foreground">
                    {item.title}
                  </p>
                  <p className="text-xs text-muted-foreground line-clamp-2">
                    {item.content}
                  </p>
                  <p className="text-[11px] text-muted-foreground/60">
                    {item.authorFirstName} {item.authorLastName} · {new Date(item.createdAt).toLocaleDateString("es-ES")}
                  </p>
                </Link>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Notifications + Calendar ──────────────────────── */}
      <div className="flex flex-col gap-6">
          {/* Notifications */}
          <section className="rounded-xl border bg-card p-5">
            <NotificationsWidget userId={profile.id} />
          </section>

          {/* Events / Calendar */}
          <section className="rounded-xl border bg-card p-5">
            <SectionHeader
              title="Próximos Eventos"
              icon={CalendarDays}
              action={
                <Link
                  href="/events"
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors"
                >
                  Ver todos
                </Link>
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
                    <Link
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
                    </Link>
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
              <form
                action={signOutAction}
                onSubmit={() => {
                  // PII hygiene: drop the identity-scoped API cache (see
                  // cacheKeyWillBeUsed in next.config.ts) on sign-out.
                  if ("caches" in window) {
                    void window.caches.delete("umsuka-api-v1");
                  }
                }}
              >
                <Button type="submit" variant="outline" size="sm" className="w-full">
                  Cerrar sesión
                </Button>
              </form>
            </div>
          </section>
        </div>
    </div>
  );
}
