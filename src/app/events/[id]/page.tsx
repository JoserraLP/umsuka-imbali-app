import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardNav } from "@/components/layout/dashboard-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getEventById } from "@/lib/events/queries";
import { getEventRegistrationSummary } from "@/lib/registrations/queries";
import { getEventAttendance, getEventAttendanceSummary } from "@/lib/attendance/queries";
import { getEventAbsences } from "@/lib/absences/queries";
import { EventForm } from "@/app/events/event-form";
import { DeleteEventButton } from "@/app/events/[id]/delete-event-button";
import { RegistrationPanel } from "@/app/events/[id]/registration-panel";
import { AttendancePanel } from "@/app/events/[id]/attendance-panel";
import { AbsencePanel } from "@/app/events/[id]/absence-panel";
import type { EventTypeValue } from "@/lib/events/schema";

export const metadata: Metadata = {
  title: "Evento",
};

const EVENT_TYPE_LABELS: Record<EventTypeValue, string> = {
  general: "General",
  meeting: "Reunión",
  carnival: "Carnaval",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "full",
  timeStyle: "short",
});

/** Converts an ISO timestamp into the "YYYY-MM-DDTHH:mm" value a <input type="datetime-local"> expects. */
function toDatetimeLocalValue(isoDate: string): string {
  const date = new Date(isoDate);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

interface EventDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function EventDetailPage({ params }: EventDetailPageProps) {
  const { id } = await params;
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const event = await getEventById(id);

  if (!event) {
    notFound();
  }

  const canManage = isManagementRole(profile.role);
  const registrationSummary = await getEventRegistrationSummary(event.id, profile.id);

  const [attendanceRecords, attendanceSummary, absences] = await Promise.all([
    canManage ? getEventAttendance(event.id) : [],
    canManage ? getEventAttendanceSummary(event.id) : null,
    getEventAbsences(event.id),
  ]);

  const viewerAbsence = absences.find((a) => a.userId === profile.id);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">{event.title}</h1>
          <p className="text-sm text-muted-foreground">
            {DATE_FORMATTER.format(new Date(event.eventDate))}
          </p>
        </div>
        <ThemeToggle />
      </header>

      <DashboardNav currentRole={profile.role} />

      <div>
        <Link href="/events" className="text-sm text-muted-foreground hover:text-foreground">
          ← Volver a eventos
        </Link>
      </div>

      {canManage ? (
        <Card>
          <CardHeader>
            <CardTitle>Editar evento</CardTitle>
            <CardDescription>
              <Badge variant="outline">{EVENT_TYPE_LABELS[event.eventType]}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <EventForm
              mode="edit"
              eventId={event.id}
              defaultValues={{
                title: event.title,
                description: event.description ?? "",
                eventType: event.eventType,
                eventDate: toDatetimeLocalValue(event.eventDate),
                capacity: event.capacity,
              }}
            />
            <div className="border-t pt-4">
              <DeleteEventButton eventId={event.id} />
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Detalles</CardTitle>
            <CardDescription>
              <Badge variant="outline">{EVENT_TYPE_LABELS[event.eventType]}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="whitespace-pre-wrap text-sm">{event.description || "Sin descripción."}</p>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Inscripción</CardTitle>
          <CardDescription>Apúntate o date de baja de este evento.</CardDescription>
        </CardHeader>
        <CardContent>
          <RegistrationPanel
            eventId={event.id}
            isViewerRegistered={registrationSummary.isViewerRegistered}
            count={registrationSummary.count}
            capacity={registrationSummary.capacity}
            attendees={registrationSummary.attendees}
            canManageAttendees={canManage}
          />
        </CardContent>
      </Card>

      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>Asistencia</CardTitle>
            <CardDescription>
              Marca quién asistió al evento.
              {attendanceSummary !== null &&
                ` ${attendanceSummary.present} presentes, ${attendanceSummary.absent} ausentes.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AttendancePanel
              eventId={event.id}
              attendees={registrationSummary.attendees}
              attendanceRecords={attendanceRecords}
            />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Ausencias</CardTitle>
          <CardDescription>
            Solicita tu ausencia o gestiona las solicitudes.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <AbsencePanel
            eventId={event.id}
            viewerId={profile.id}
            absences={absences}
            canManage={canManage}
            viewerAbsenceId={viewerAbsence?.id ?? null}
          />
        </CardContent>
      </Card>
    </main>
  );
}
