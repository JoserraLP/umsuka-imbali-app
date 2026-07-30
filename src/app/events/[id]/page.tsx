import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getEventById } from "@/lib/events/queries";
import { getEventRegistrationSummary } from "@/lib/registrations/queries";
import { getEventAttendance, getEventAttendanceSummary } from "@/lib/attendance/queries";
import { getEventAbsences, getUserAbsenceForEvent } from "@/lib/absences/queries";
import {
  getAllWorkgroupMembers,
  getWorkgroupAttendanceByShift,
} from "@/lib/workgroups/queries";
import { getEventShifts, getAvailableMembers } from "@/lib/shifts/queries";
import { EventForm } from "@/app/events/event-form";
import { DeleteEventButton } from "@/app/events/[id]/delete-event-button";
import { RegistrationPanel } from "@/app/events/[id]/registration-panel";
import { AttendancePanel } from "@/app/events/[id]/attendance-panel";
import { AbsencePanel } from "@/app/events/[id]/absence-panel";
import { WorkgroupAttendancePanel } from "@/app/events/[id]/workgroup-panel";
import { ShiftManagementPanel } from "@/app/events/[id]/shift-management-panel";
import type { EventTypeValue } from "@/lib/events/schema";

export const metadata: Metadata = {
  title: "Evento",
};

const EVENT_TYPE_LABELS: Record<EventTypeValue, string> = {
  general: "General",
  meeting: "Reunión",
  carnival: "Carnaval",
  work_shift: "Turno de trabajo",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "full",
  timeStyle: "short",
});

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

  const isWorkShift = event.eventType === "work_shift";
  const canManage = isManagementRole(profile.role) || (isWorkShift && profile.isWorkgroupLead);
  const registrationSummary = await getEventRegistrationSummary(event.id, profile.id);

  const [attendanceRecords, attendanceSummary, absences] = await Promise.all([
    canManage ? getEventAttendance(event.id) : [],
    canManage ? getEventAttendanceSummary(event.id) : null,
    canManage ? getEventAbsences(event.id) : [],
  ]);

  const viewerAbsence = await (canManage
    ? Promise.resolve(absences.find((a) => a.userId === profile.id) ?? null)
    : getUserAbsenceForEvent(profile.id, event.id));

  const [shifts, availableMembers] = await Promise.all([
    getEventShifts(event.id),
    getAvailableMembers(),
  ]);
  const firstShift = shifts[0] ?? null;

  const canViewWorkgroupPanel =
    profile.role === "super_admin" || profile.isWorkgroupLead || isWorkShift;

  let workgroupMembers: Awaited<ReturnType<typeof getAllWorkgroupMembers>> = [];
  let workgroupAttendanceRecords: Awaited<
    ReturnType<typeof getWorkgroupAttendanceByShift>
  > = [];

  if (canViewWorkgroupPanel && firstShift) {
    [workgroupMembers, workgroupAttendanceRecords] = await Promise.all([
      getAllWorkgroupMembers(),
      getWorkgroupAttendanceByShift(firstShift.id),
    ]);
  }

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <div className="mb-1 flex items-start justify-between">
            <h1 className="text-xl font-bold tracking-tight">{event.title}</h1>
            <Badge variant="outline">{EVENT_TYPE_LABELS[event.eventType]}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            {DATE_FORMATTER.format(new Date(event.eventDate))}
          </p>
          <Link href="/events" className="mt-2 inline-block text-sm text-muted-foreground hover:text-foreground">
            ← Volver a eventos
          </Link>
        </div>

        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Editar evento</CardTitle>
              <CardDescription>Modifica los datos del evento.</CardDescription>
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

        {!isWorkShift && (
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
        )}

        {canManage && !isWorkShift && (
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

        {/* Shift management panel — shown for all event types */}
        <Card>
          <CardHeader>
            <CardTitle>Gestión de turnos</CardTitle>
            <CardDescription>
              Crea turnos, asigna miembros y visualiza la línea temporal.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ShiftManagementPanel
              eventId={event.id}
              shifts={shifts}
              availableMembers={availableMembers}
              canManage={canManage}
            />
          </CardContent>
        </Card>

        {canViewWorkgroupPanel && firstShift && (
          <Card>
            <CardHeader>
              <CardTitle>Asistencia por grupo de trabajo</CardTitle>
              <CardDescription>
                Marca quién asistió a su grupo de trabajo en el turno &laquo;
                {firstShift.name}&raquo;.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <WorkgroupAttendancePanel
                shiftId={firstShift.id}
                shiftName={firstShift.name}
                members={workgroupMembers}
                attendanceRecords={workgroupAttendanceRecords}
                currentUserWorkgroup={profile.workgroup}
                isLead={profile.isWorkgroupLead}
                isSuperAdmin={profile.role === "super_admin"}
              />
            </CardContent>
          </Card>
        )}

        {!isWorkShift && (
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
                absences={absences}
                canManage={canManage}
                viewerAbsenceId={viewerAbsence?.id ?? null}
              />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
