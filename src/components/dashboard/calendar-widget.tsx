import Link from "next/link";
import { CalendarDays, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SectionHeader } from "@/components/dashboard/section-header";
import { listEvents } from "@/lib/events/queries";
import type { EventListItem } from "@/lib/events/queries";

// ── Event type label mapping ───────────────────────────

const EVENT_TYPE_LABELS: Record<string, string> = {
  general: "General",
  meeting: "Reunión",
  carnival: "Carnaval",
  work_shift: "Turno",
};

const EVENT_TYPE_VARIANTS: Record<string, "default" | "secondary" | "outline" | "destructive"> = {
  general: "default",
  meeting: "secondary",
  carnival: "destructive",
  work_shift: "outline",
};

// ── Helpers ─────────────────────────────────────────────

function formatEventDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const isTomorrow =
    new Date(now.getTime() + 86400000).getDate() === date.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear();

  const day = date.toLocaleDateString("es-ES", { weekday: "short" });
  const dayNum = date.getDate();
  const month = date.toLocaleDateString("es-ES", { month: "short" });
  const time = date.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });

  const prefix = isToday ? "Hoy" : isTomorrow ? "Mañana" : `${day} ${dayNum} ${month}`;
  return `${prefix} · ${time}`;
}

// ── Component ──────────────────────────────────────────

interface CalendarWidgetProps {
  /** Maximum number of events to display (default 5). */
  limit?: number;
}

/**
 * Calendar widget that displays the next upcoming events.
 *
 * Fetches events from the umsuka.events table ordered by event_date ASC,
 * filters to future events, and shows up to `limit` items.
 */
export async function CalendarWidget({ limit = 5 }: CalendarWidgetProps) {
  const allEvents: EventListItem[] = await listEvents({
    from: new Date().toISOString(),
  });

  const upcomingEvents = allEvents.slice(0, limit);

  return (
    <section>
      <SectionHeader
        title="Próximos Eventos"
        icon={CalendarDays}
        action={
          <Link
            href="/events"
            className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            Ver todos
            <ArrowRight className="h-3 w-3" aria-hidden="true" />
          </Link>
        }
      />

      {upcomingEvents.length === 0 ? (
        <div className="mt-2 flex flex-col items-center justify-center rounded-xl border border-dashed border-border py-8 text-center">
          <CalendarDays className="mb-2 h-8 w-8 text-muted-foreground/40" />
          <p className="text-sm text-muted-foreground">No hay próximos eventos</p>
          <p className="mt-1 text-xs text-muted-foreground/60">
            Los eventos programados aparecerán aquí.
          </p>
        </div>
      ) : (
        <ul className="mt-1 divide-y divide-border" role="list">
          {upcomingEvents.map((event) => (
            <li key={event.id}>
              <Link
                href={`/events/${event.id}`}
                className="flex items-start justify-between gap-3 px-2 py-3 transition-colors hover:bg-accent/50 rounded-lg"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium leading-tight text-foreground truncate">
                    {event.title}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {formatEventDate(event.eventDate)}
                  </p>
                </div>
                <Badge variant={EVENT_TYPE_VARIANTS[event.eventType] ?? "outline"} className="shrink-0 text-[10px]">
                  {EVENT_TYPE_LABELS[event.eventType] ?? event.eventType}
                </Badge>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
