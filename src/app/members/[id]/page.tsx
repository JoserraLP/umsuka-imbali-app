import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
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
import { canViewMembers, canViewMemberDetail } from "@/lib/members/authorization";
import { getMemberDetailAction } from "@/app/members/actions";
import { getMinorWithGuardian, getMinorsByGuardian } from "@/lib/guardians/queries";
import { computeParticipationFromCounts } from "@/lib/rehearsals/stats";

export const metadata: Metadata = {
  title: "Ficha de miembro",
};

interface PageProps {
  params: Promise<{ id: string }>;
}

const WORKGROUP_LABELS: Record<string, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
  ninguno: "Ninguno",
};

const COMPONENT_TYPE_LABELS: Record<string, string> = {
  music: "Música",
  dance: "Baile",
  member: "Socio/a",
};

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super admin",
  admin: "Admin",
  board_member: "Directiva",
  event_manager: "Eventos",
  member: "Miembro",
  guest: "Invitado",
};

const STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente",
  active: "Activo",
  suspended: "Suspendido",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", { dateStyle: "long" });
const SHIFT_DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function MemberDetailPage({ params }: PageProps) {
  const { id } = await params;
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  if (!canViewMembers(profile)) {
    redirect("/dashboard");
  }

  const result = await getMemberDetailAction(id);

  if (!result.success || !result.data) {
    notFound();
  }

  const { member, shifts, attendance, rehearsalAttendance } = result.data;

  // Defense in depth: a lead must never see a member outside their
  // group/component (component scope takes precedence when both apply).
  if (
    !canViewMemberDetail(profile, {
      workgroup: member.workgroup,
      componentType: member.componentType,
    })
  ) {
    notFound();
  }

  const isManagement = isManagementRole(profile.role);
  const [minorWithGuardian, minorsInCharge] = await Promise.all([
    getMinorWithGuardian(member.id).catch(() => null),
    getMinorsByGuardian(member.id).catch(() => []),
  ]);
  const isMinor = minorWithGuardian?.profile.isMinor ?? false;
  const guardian = minorWithGuardian?.guardian ?? null;

  const present = attendance.filter((record) => record.attended).length;
  const absent = attendance.length - present;

  // Sprint 27: per-session rehearsal participation ("Ensayos: X/Y (Z %)").
  const rehearsalPresent = rehearsalAttendance.filter((record) => record.attended).length;
  const rehearsalParticipation = computeParticipationFromCounts(
    rehearsalPresent,
    rehearsalAttendance.length,
  );
  const rehearsalLine =
    rehearsalAttendance.length > 0
      ? ` Ensayos: ${rehearsalPresent}/${rehearsalAttendance.length}${
          rehearsalParticipation !== null ? ` (${rehearsalParticipation}%)` : ""
        }.`
      : "";

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">
            {member.firstName} {member.lastName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">Ficha de miembro.</p>
          <Link
            href="/members"
            className="mt-2 inline-block text-sm text-muted-foreground hover:text-foreground"
          >
            ← Volver al directorio
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Perfil</CardTitle>
            <CardDescription>Datos de alta del miembro.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center gap-2">
            <Badge variant="outline">
              {COMPONENT_TYPE_LABELS[member.componentType] ?? member.componentType}
            </Badge>
            <Badge variant="outline">
              {WORKGROUP_LABELS[member.workgroup] ?? member.workgroup}
            </Badge>
            <Badge variant="secondary">{ROLE_LABELS[member.role] ?? member.role}</Badge>
            <Badge
              variant={
                member.status === "active"
                  ? "default"
                  : member.status === "pending"
                    ? "secondary"
                    : "destructive"
              }
            >
              {STATUS_LABELS[member.status] ?? member.status}
            </Badge>
            <Badge variant={member.isActive ? "default" : "destructive"}>
              {member.isActive ? "Alta" : "Baja"}
            </Badge>
            {isMinor && <Badge variant="secondary">Menor</Badge>}
            {member.authMethod === "email_alias" ? (
              <Badge variant="outline">Cuenta local</Badge>
            ) : member.linkStatus === "pending_gmail" ? (
              <Badge variant="secondary">Pendiente de Gmail</Badge>
            ) : (
              <Badge variant="outline">Vinculado a Gmail</Badge>
            )}
          </CardContent>
          <CardContent className="border-t pt-4 text-sm text-muted-foreground">
            <p>Fecha de alta: {DATE_FORMATTER.format(new Date(member.createdAt))}</p>
            {isManagement && member.birthDate && (
              <p className="mt-1">Fecha de nacimiento: {DATE_FORMATTER.format(new Date(member.birthDate))}</p>
            )}
          </CardContent>
        </Card>

        {(isMinor || minorsInCharge.length > 0) && (
          <Card>
            <CardHeader>
              <CardTitle>Representante legal</CardTitle>
              <CardDescription>
                {isMinor ? "Datos del representante del menor." : "Menores a cargo de este miembro."}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              {isMinor && (
                <div className="rounded-md border p-3">
                  <p className="font-medium">Representante</p>
                  {guardian ? (
                    <>
                      <p>{guardian.fullName} {guardian.relationship ? `· ${guardian.relationship}` : ""}</p>
                      {guardian.email && <p className="text-muted-foreground">Email: {guardian.email}</p>}
                      {guardian.phone && <p className="text-muted-foreground">Tel: {guardian.phone}</p>}
                      {guardian.isMember && <Badge variant="outline" className="mt-1">Miembro</Badge>}
                    </>
                  ) : (
                    <p className="text-muted-foreground">Sin representante asignado.</p>
                  )}
                </div>
              )}
              {minorsInCharge.length > 0 && (
                <div className="rounded-md border p-3">
                  <p className="font-medium">Menores a cargo ({minorsInCharge.length})</p>
                  <div className="mt-2 flex flex-col gap-1">
                    {minorsInCharge.map((m) => (
                      <Link key={m.id} href={`/members/${m.id}`} className="text-primary hover:underline">
                        {m.firstName} {m.lastName}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Turnos asignados</CardTitle>
            <CardDescription>Turnos de trabajo asignados al miembro.</CardDescription>
          </CardHeader>
          <CardContent>
            {shifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tiene turnos asignados.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Turno</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Fecha y hora</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shifts.map((shift) => (
                    <TableRow key={shift.shiftId}>
                      <TableCell className="font-medium">{shift.shiftName}</TableCell>
                      <TableCell>
                        <Link
                          href={`/events/${shift.eventId}`}
                          className="hover:underline hover:text-primary"
                        >
                          {shift.eventTitle}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {SHIFT_DATE_FORMATTER.format(new Date(shift.startTime))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Asistencia</CardTitle>
            <CardDescription>
              {attendance.length === 0
                ? "Sin registros de asistencia."
                : `${present} presentes, ${absent} ausentes.`}
              {rehearsalLine}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {attendance.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay registros de asistencia.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Evento</TableHead>
                    <TableHead>Fecha del evento</TableHead>
                    <TableHead>Asistió</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {attendance.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/events/${record.eventId}`}
                          className="hover:underline hover:text-primary"
                        >
                          {record.eventTitle}
                        </Link>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {record.eventDate ? DATE_FORMATTER.format(new Date(record.eventDate)) : "—"}
                      </TableCell>
                      <TableCell>
                        {record.attended ? (
                          <Badge className="bg-green-100 text-green-700">Sí</Badge>
                        ) : (
                          <Badge variant="destructive">No</Badge>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
