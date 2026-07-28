import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DashboardNav } from "@/components/layout/dashboard-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { listEvents } from "@/lib/events/queries";
import type { EventTypeValue } from "@/lib/events/schema";

export const metadata: Metadata = {
  title: "Eventos",
};

const EVENT_TYPE_LABELS: Record<EventTypeValue, string> = {
  general: "General",
  meeting: "Reunión",
  carnival: "Carnaval",
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

  const canManage = isManagementRole(profile.role);
  const events = await listEvents();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-4xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Eventos</h1>
          <p className="text-sm text-muted-foreground">Actividades, reuniones y carnaval.</p>
        </div>
        <ThemeToggle />
      </header>

      <DashboardNav currentRole={profile.role} />

      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Todos los eventos</CardTitle>
            <CardDescription>
              <Link href="/calendar" className="hover:text-foreground">
                Ver en calendario →
              </Link>
            </CardDescription>
          </div>
          {canManage && (
            <Button asChild size="sm">
              <Link href="/events/new">Nuevo evento</Link>
            </Button>
          )}
        </CardHeader>
        <CardContent>
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
                    <Badge variant="outline">{EVENT_TYPE_LABELS[event.eventType]}</Badge>
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
        </CardContent>
      </Card>
    </main>
  );
}
