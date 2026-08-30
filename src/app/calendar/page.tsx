import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { listEvents, type EventListItem } from "@/lib/events/queries";
import { buildMonthGrid, monthDateRange, dayKey } from "@/lib/events/calendar";
import { cn } from "@/lib/utils";
import type { EventTypeValue } from "@/lib/events/schema";

export const metadata: Metadata = {
  title: "Calendario",
};

const MONTH_NAMES = [
  "enero", "febrero", "marzo", "abril", "mayo", "junio",
  "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre",
];

const WEEKDAY_LABELS = ["L", "M", "X", "J", "V", "S", "D"];

const EVENT_TYPE_LABELS: Record<EventTypeValue, string> = {
  general: "General",
  meeting: "Reunión",
  carnival: "Carnaval",
  work_shift: "Turno de trabajo",
  rehearsal: "Ensayo",
  material_distribution: "Reparto de material",
  reunion: "Reunión con acta",
};

const EVENT_TYPE_DOT_STYLES: Record<EventTypeValue, string> = {
  general: "bg-blue-500",
  meeting: "bg-amber-500",
  carnival: "bg-fuchsia-500",
  work_shift: "bg-emerald-500",
  rehearsal: "bg-violet-500",
  material_distribution: "bg-orange-500",
  reunion: "bg-teal-500",
};

const EVENT_TYPE_CHIP_STYLES: Record<EventTypeValue, string> = {
  general: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300",
  meeting: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300",
  carnival: "bg-fuchsia-100 text-fuchsia-800 dark:bg-fuchsia-950 dark:text-fuchsia-300",
  work_shift: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300",
  rehearsal: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-300",
  material_distribution: "bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300",
  reunion: "bg-teal-100 text-teal-800 dark:bg-teal-950 dark:text-teal-300",
};

interface CalendarPageProps {
  searchParams: Promise<{ year?: string; month?: string }>;
}

function resolveYearMonth(params: { year?: string; month?: string }): { year: number; month: number } {
  const today = new Date();
  const year = Number(params.year);
  const month = Number(params.month);

  return {
    year: Number.isInteger(year) && year > 0 ? year : today.getFullYear(),
    month: Number.isInteger(month) && month >= 1 && month <= 12 ? month : today.getMonth() + 1,
  };
}

export default async function CalendarPage({ searchParams }: CalendarPageProps) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const { year, month } = resolveYearMonth(await searchParams);
  const { from, to } = monthDateRange(year, month);
  const events = await listEvents(
    { from, to },
    {
      workgroup: profile.workgroup,
      componentType: profile.componentType,
      isManagement: isManagementRole(profile.role),
    },
  );
  const weeks = buildMonthGrid(year, month);

  const eventsByDay = new Map<string, EventListItem[]>();
  for (const event of events) {
    const key = dayKey(new Date(event.eventDate));
    const dayEvents = eventsByDay.get(key) ?? [];
    dayEvents.push(event);
    eventsByDay.set(key, dayEvents);
  }

  const prevMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Calendario</h1>
          <p className="mt-1 text-sm text-muted-foreground">Todos los eventos de la asociación.</p>
        </div>

        <Card>
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardTitle>
              {MONTH_NAMES[month - 1]} {year}
            </CardTitle>
            <div className="flex items-center gap-3 text-sm">
              <Link
                href={`/calendar?year=${prevMonth.year}&month=${prevMonth.month}`}
                className="text-muted-foreground hover:text-foreground"
              >
                ← Anterior
              </Link>
              <Link href="/events" className="text-muted-foreground hover:text-foreground">
                Ver lista
              </Link>
              <Link
                href={`/calendar?year=${nextMonth.year}&month=${nextMonth.month}`}
                className="text-muted-foreground hover:text-foreground"
              >
                Siguiente →
              </Link>
            </div>
          </CardHeader>
          <CardContent>
            <div className="mb-4 flex flex-wrap gap-4 text-xs text-muted-foreground">
              {Object.entries(EVENT_TYPE_LABELS).map(([type, label]) => (
                <span key={type} className="flex items-center gap-1.5">
                  <span
                    className={cn("h-2.5 w-2.5 rounded-full", EVENT_TYPE_DOT_STYLES[type as EventTypeValue])}
                  />
                  {label}
                </span>
              ))}
            </div>

            <div className="overflow-x-auto">
              <div className="min-w-[640px]">
                <div className="grid grid-cols-7 border-b text-center text-xs font-medium text-muted-foreground">
                  {WEEKDAY_LABELS.map((label) => (
                    <div key={label} className="py-2">
                      {label}
                    </div>
                  ))}
                </div>

                {weeks.map((week, weekIndex) => (
                  <div key={weekIndex} className="grid grid-cols-7 border-b last:border-b-0">
                    {week.map((day) => {
                      const key = dayKey(day.date);
                      const dayEvents = eventsByDay.get(key) ?? [];

                      return (
                        <div
                          key={key}
                          className={cn(
                            "min-h-[96px] border-r p-1.5 last:border-r-0",
                            !day.inCurrentMonth && "bg-muted/30 text-muted-foreground",
                          )}
                        >
                          <div className="text-xs">{day.date.getDate()}</div>
                          <div className="mt-1 flex flex-col gap-1">
                            {dayEvents.slice(0, 3).map((event) => (
                              <Link
                                key={event.id}
                                href={`/events/${event.id}`}
                                title={event.title}
                                className={cn(
                                  "truncate rounded px-1 py-0.5 text-[11px] leading-tight",
                                  EVENT_TYPE_CHIP_STYLES[event.eventType],
                                )}
                              >
                                {event.title}
                              </Link>
                            ))}
                            {dayEvents.length > 3 && (
                              <span className="text-[11px] text-muted-foreground">
                                +{dayEvents.length - 3} más
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
