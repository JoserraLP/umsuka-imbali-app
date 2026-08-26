import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import {
  getEventById,
  getEventComments,
  getWaitlistForEvent,
  getMyWaitlistEntry,
  computeRegistrationStatus,
} from "@/lib/events/queries";
import { getEventRegistrationSummary } from "@/lib/registrations/queries";
import { getEventAttendance, getEventAttendanceSummary } from "@/lib/attendance/queries";
import { getEventAbsences, getUserAbsenceForEvent } from "@/lib/absences/queries";
import { getAllWorkgroupMembers, getWorkgroupAttendanceByShift } from "@/lib/workgroups/queries";
import { getEventShifts, getAvailableMembers } from "@/lib/shifts/queries";
import { getAudienceOptions, getAudienceSummary, getEventAudience } from "@/lib/events/audience";
import { isAttendanceOnlyEventType } from "@/lib/events/policy";
import { getRehearsalAttendance } from "@/lib/rehearsals/queries";
import type { RehearsalSession } from "@/types/database.types";
import { ACTIVE_WORKGROUPS, type ActiveWorkgroup } from "@/lib/workgroups/schema";
import { EventForm } from "@/app/events/event-form";
import { AudienceEditor } from "@/app/events/[id]/audience-editor";
import { DeleteEventButton } from "@/app/events/[id]/delete-event-button";
import { RegistrationPanel } from "@/app/events/[id]/registration-panel";
import { CommentsSection } from "@/app/events/[id]/comments-section";
import { AttendancePanel } from "@/app/events/[id]/attendance-panel";
import { RehearsalAttendancePanel } from "@/app/events/[id]/rehearsal-attendance-panel";
import { EventStatsCard } from "@/app/events/[id]/event-stats-card";
import { AbsencePanel } from "@/app/events/[id]/absence-panel";
import { WorkgroupAttendancePanel } from "@/app/events/[id]/workgroup-panel";
import { ShiftManagementPanel } from "@/app/events/[id]/shift-management-panel";
import { CalendarClock, MapPin } from "lucide-react";
import type { EventTypeValue, EventWorkgroup } from "@/lib/events/schema";
import { PaymentEligibility } from "@/app/events/[id]/payment-eligibility";

export const metadata: Metadata = {
  title: "Evento",
};

  const EVENT_TYPE_LABELS: Record<EventTypeValue, string> = {
  general: "General",
  meeting: "Reunión",
  carnival: "Carnaval",
  work_shift: "Turno de trabajo",
  rehearsal: "Ensayo",
  material_distribution: "Reparto de material",
};

const REHEARSAL_CATEGORY_LABELS: Record<string, string> = {
  music: "Música",
  dance: "Baile",
};

const WORKGROUP_LABELS: Record<string, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
  ninguno: "Ninguno",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "full",
  timeStyle: "short",
});

const DEADLINE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "long",
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

  const event = await getEventById(id, {
    workgroup: profile.workgroup,
    componentType: profile.componentType,
    isManagement: isManagementRole(profile.role),
  });

  if (!event) {
    notFound();
  }

  const isWorkShift = event.eventType === "work_shift";
  const isRehearsal = event.eventType === "rehearsal";
  // Management can manage any event; a workgroup lead can only manage the
  // work_shift events they created for their own group (Sprint 12).
  const canManage =
    isManagementRole(profile.role) ||
    (isWorkShift && profile.isWorkgroupLead && event.createdBy === profile.id);

  // Sprint 18: audience badge + quick editor are available to management
  // and the event creator (for non-work_shift events that is management).
  const canViewAudience =
    isManagementRole(profile.role) || event.createdBy === profile.id;
  const [eventAudience, audienceOptions] = canManage
    ? await Promise.all([getEventAudience(event.id), getAudienceOptions()])
    : [null, []];
  // Sprint 17b: meeting/carnival/rehearsal events are attendance-only —
  // they have no shifts (nor workgroup attendance) and no absences.
  const canHaveShifts = !isAttendanceOnlyEventType(event.eventType);
  const canHaveAbsences = event.eventType === "general";
  const registrationSummary = await getEventRegistrationSummary(event.id, profile.id);

  const [comments, myWaitlistEntry] = await Promise.all([
    getEventComments(event.id),
    getMyWaitlistEntry(event.id, profile.id),
  ]);
  const waitlist = canManage ? await getWaitlistForEvent(event.id) : [];

  const registrationStatus = computeRegistrationStatus({
    capacity: registrationSummary.capacity,
    registeredCount: registrationSummary.count,
    registrationDeadline: event.registrationDeadline,
    viewerRegistered: registrationSummary.isViewerRegistered,
    viewerWaitlistPosition: myWaitlistEntry?.position ?? null,
    now: new Date(),
  });

  // Rehearsals use the per-session panel instead of the generic one, so
  // the generic attendance queries are skipped for them.
  const [attendanceRecords, attendanceSummary, absences, rehearsalRecords] = await Promise.all([
    canManage && !isRehearsal ? getEventAttendance(event.id) : [],
    canManage && !isRehearsal ? getEventAttendanceSummary(event.id) : null,
    canManage && canHaveAbsences ? getEventAbsences(event.id) : [],
    canManage && isRehearsal ? getRehearsalAttendance(event.id) : [],
  ]);

  /** Enabled sessions of this rehearsal (at least one by constraint). */
  const rehearsalSessions: RehearsalSession[] = [
    ...(event.morningSession ? (["morning"] as const) : []),
    ...(event.afternoonSession ? (["afternoon"] as const) : []),
  ];

  // Sprint 32: derive attendees for rehearsal from enrolled records (auto-enroll), not registrations
  const rehearsalAttendees = isRehearsal
    ? Array.from(
        new Map(
          rehearsalRecords.map((r) => [r.userId, { userId: r.userId, firstName: r.firstName, lastName: r.lastName }]),
        ).values(),
      )
    : [];
  const panelAttendees = isRehearsal ? (rehearsalAttendees.length > 0 ? rehearsalAttendees : registrationSummary.attendees) : [];

  const viewerAbsence = await (canManage
    ? Promise.resolve(absences.find((a) => a.userId === profile.id) ?? null)
    : canHaveAbsences
      ? getUserAbsenceForEvent(profile.id, event.id)
      : Promise.resolve(null));

  let shifts: Awaited<ReturnType<typeof getEventShifts>> = [];
  let availableMembers: Awaited<ReturnType<typeof getAvailableMembers>> = [];

  if (canHaveShifts) {
    [shifts, availableMembers] = await Promise.all([
      getEventShifts(event.id),
      getAvailableMembers(),
    ]);
  }
  const firstShift = shifts[0] ?? null;

  const canViewWorkgroupPanel =
    profile.role === "super_admin" || profile.isWorkgroupLead || isWorkShift;

  // Sprint 26: groups whose attendance the viewer may mark through the
  // shift member search — same rules as workgroups/mutations
  // assertCanManageWorkgroup: super_admin → all; a lead → their own group;
  // everyone else → none.
  const manageableWorkgroups: ActiveWorkgroup[] =
    profile.role === "super_admin"
      ? [...ACTIVE_WORKGROUPS]
      : profile.isWorkgroupLead && profile.workgroup !== "ninguno"
        ? [profile.workgroup]
        : [];

  let workgroupMembers: Awaited<ReturnType<typeof getAllWorkgroupMembers>> = [];
  let workgroupAttendanceRecords: Awaited<ReturnType<typeof getWorkgroupAttendanceByShift>> = [];

  if (canViewWorkgroupPanel && firstShift) {
    // A non-management lead only sees their own group's members in the
    // workgroup attendance panel; management keeps the full list.
    const leadWorkgroup =
      profile.isWorkgroupLead && !isManagementRole(profile.role) ? profile.workgroup : null;

    [workgroupMembers, workgroupAttendanceRecords] = await Promise.all([
      getAllWorkgroupMembers(leadWorkgroup),
      getWorkgroupAttendanceByShift(firstShift.id),
    ]);
  }

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <div className="mb-1 flex items-start justify-between">
            <h1 className="text-xl font-bold tracking-tight">{event.title}</h1>
            <div className="flex items-center gap-2">
              {event.visibleToGroup !== null && (
                <Badge variant="secondary">Grupo: {WORKGROUP_LABELS[event.visibleToGroup]}</Badge>
              )}
              {canViewAudience && event.audienceType !== "all" && (
                <Badge variant="outline">
                  {getAudienceSummary(event, eventAudience?.users.length)}
                </Badge>
              )}
              {isRehearsal && event.rehearsalCategory && (
                <Badge variant="secondary">Categoría: {REHEARSAL_CATEGORY_LABELS[event.rehearsalCategory] ?? event.rehearsalCategory}</Badge>
              )}
              <Badge variant="outline">{EVENT_TYPE_LABELS[event.eventType]}</Badge>
            </div>
          </div>
          <p className="text-sm text-muted-foreground">
            {DATE_FORMATTER.format(new Date(event.eventDate))}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            {event.location !== null && (
              <span className="flex items-center gap-1">
                <MapPin className="h-4 w-4" aria-hidden="true" />
                {event.location}
              </span>
            )}
            {event.registrationDeadline !== null && (
              <Badge
                variant={registrationStatus.isDeadlinePassed ? "destructive" : "secondary"}
                className="gap-1"
              >
                <CalendarClock className="h-3 w-3" aria-hidden="true" />
                {registrationStatus.isDeadlinePassed
                  ? "Inscripción cerrada"
                  : `Inscripción hasta ${DEADLINE_FORMATTER.format(new Date(event.registrationDeadline))}`}
              </Badge>
            )}
          </div>
          <Link
            href="/events"
            className="mt-2 inline-block text-sm text-muted-foreground hover:text-foreground"
          >
            ← Volver a eventos
          </Link>
        </div>

        {event.imageUrl !== null && (
          // The project does not use next/image remote patterns; a plain
          // <img> keeps next.config.ts untouched (see migration comment).
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={event.imageUrl}
            alt={event.title}
            className="aspect-video w-full rounded-xl border border-border object-cover"
          />
        )}

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
                  location: event.location ?? "",
                  imageUrl: event.imageUrl ?? "",
                  registrationDeadline: event.registrationDeadline
                    ? toDatetimeLocalValue(event.registrationDeadline)
                    : "",
                  morningSession: event.morningSession,
                  afternoonSession: event.afternoonSession,
                  rehearsalCategory: (event.rehearsalCategory as "music" | "dance" | null) ?? null,
                  workgroup: event.visibleToGroup as EventWorkgroup | null,
                  audienceType: event.audienceType,
                  audienceWorkgroup: event.audienceWorkgroup as EventWorkgroup | null,
                  audienceMemberType: event.audienceMemberType,
                  audienceUserIds: (eventAudience?.users ?? []).map((user) => user.id),
                }}
                leadWorkgroup={
                  !isManagementRole(profile.role) && profile.isWorkgroupLead
                    ? profile.workgroup
                    : undefined
                }
                audienceMembers={audienceOptions}
                selectedAudienceUsers={eventAudience?.users ?? []}
                canConfigureAudience={false}
              />
              {canViewAudience && (
                <div className="border-t pt-4">
                  <AudienceEditor
                    eventId={event.id}
                    eventType={event.eventType}
                    initial={eventAudience}
                    members={audienceOptions}
                  />
                </div>
              )}
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
              <p className="whitespace-pre-wrap text-sm">
                {event.description || "Sin descripción."}
              </p>
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
                registrationStatus={registrationStatus}
                attendees={registrationSummary.attendees}
                waitlist={waitlist}
                canManageAttendees={canManage}
              />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Comentarios</CardTitle>
            <CardDescription>Comenta sobre el evento: dudas, propuestas y avisos.</CardDescription>
          </CardHeader>
          <CardContent>
            <CommentsSection
              eventId={event.id}
              comments={comments}
              viewerId={profile.id}
              canManage={canManage}
            />
          </CardContent>
        </Card>

        {/* Sprint 27: rehearsals use the per-session attendance panel. */}
        {canManage && isRehearsal && (
          <Card>
            <CardHeader>
              <CardTitle>Asistencia a ensayos</CardTitle>
              <CardDescription>
                {event.rehearsalCategory
                  ? `Ensayo de ${REHEARSAL_CATEGORY_LABELS[event.rehearsalCategory]} — ${rehearsalRecords.filter((r) => r.enrolled).length} inscritos · Marca quién asistió a cada sesión.`
                  : "Marca quién asistió a cada sesión del ensayo (mañana/tarde)."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <EventStatsCard
                summary={null}
                rehearsalRecords={rehearsalRecords}
                sessions={rehearsalSessions}
              />
              <RehearsalAttendancePanel
                eventId={event.id}
                sessions={rehearsalSessions}
                attendees={panelAttendees}
                records={rehearsalRecords}
              />
              {event.rehearsalCategory && rehearsalRecords.length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Inscritos automáticamente: {rehearsalRecords.filter((r) => r.enrolled).length} · Pendientes de marcar: {rehearsalRecords.filter((r) => r.enrolled && !r.attended).length}
                </p>
              )}
            </CardContent>
          </Card>
        )}

        {canManage && !isWorkShift && !isRehearsal && (
          <Card>
            <CardHeader>
              <CardTitle>Asistencia</CardTitle>
              <CardDescription>
                Marca quién asistió al evento.
                {attendanceSummary !== null &&
                  ` ${attendanceSummary.present} presentes, ${attendanceSummary.absent} ausentes.`}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <EventStatsCard
                summary={attendanceSummary}
                rehearsalRecords={null}
                sessions={[]}
              />
              <AttendancePanel
                eventId={event.id}
                attendees={registrationSummary.attendees}
                attendanceRecords={attendanceRecords}
              />
            </CardContent>
          </Card>
        )}

        {/* Shift management panel — shown for event types that support
            shifts (general, work_shift); hidden for attendance-only
            events (meeting, carnival, rehearsal). */}
        {canHaveShifts && (
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
                attendanceContext={{ manageableWorkgroups }}
              />
            </CardContent>
          </Card>
        )}

        {canHaveShifts && canViewWorkgroupPanel && firstShift && (
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

        {event.eventType === "material_distribution" && canManage && <PaymentEligibility eventId={event.id} />}

        {canHaveAbsences && (
          <Card>
            <CardHeader>
              <CardTitle>Ausencias</CardTitle>
              <CardDescription>Solicita tu ausencia o gestiona las solicitudes.</CardDescription>
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
