import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { listEvents } from "@/lib/events/queries";
import { getAudienceSummary, getAudienceUserCounts } from "@/lib/events/audience";
import type { EventTypeValue } from "@/lib/events/schema";
import type { Workgroup } from "@/types/database.types";

export const metadata: Metadata = {
  title: "Eventos",
};

const EVENT_TYPE_LABELS: Record<EventTypeValue, string> = {
  general: "General",
  meeting: "Reunión",
  carnival: "Carnaval",
  work_shift: "Turno de trabajo",
};

const WORKGROUP_LABELS: Record<Workgroup, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
  ninguno: "Ninguno",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function EventsPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const canManage = isManagementRole(profile.role) || profile.isWorkgroupLead;
  const events = await listEvents(undefined, {
    workgroup: profile.workgroup,
    componentType: profile.componentType,
    isManagement: isManagementRole(profile.role),
  });

  // Concrete-user counts for the audience badges (ONE batched query).
  const specificUsersEventIds = events
    .filter((event) => event.audienceType === "specific_users")
    .map((event) => event.id);
  const audienceUserCounts = await getAudienceUserCounts(specificUsersEventIds);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight">Eventos</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Actividades, reuniones y carnaval.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/calendar">Calendario</Link>
            </Button>
            {canManage && (
              <Button asChild size="sm">
                <Link href="/events/new">Nuevo evento</Link>
              </Button>
            )}
          </div>
        </div>

        <div className="rounded-xl border bg-card">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Título</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Fecha</TableHead>
                <TableHead>Aforo</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="font-medium">
                    <Link href={`/events/${event.id}`} className="hover:underline">
                      {event.title}
                    </Link>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline">{EVENT_TYPE_LABELS[event.eventType]}</Badge>
                      {event.visibleToGroup !== null && (
                        <Badge variant="secondary">Grupo: {WORKGROUP_LABELS[event.visibleToGroup]}</Badge>
                      )}
                      {(isManagementRole(profile.role) || event.createdBy === profile.id) &&
                        event.audienceType !== "all" && (
                          <Badge variant="outline">
                            {getAudienceSummary(
                              event,
                              audienceUserCounts.get(event.id),
                            )}
                          </Badge>
                        )}
                    </div>
                  </TableCell>
                  <TableCell>{DATE_FORMATTER.format(new Date(event.eventDate))}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {event.capacity !== null ? `${event.capacity} plazas` : "Sin límite"}
                  </TableCell>
                </TableRow>
              ))}
              {events.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-sm text-muted-foreground">
                    Todavía no hay eventos.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
      </div>
    </AppShell>
  );
}
