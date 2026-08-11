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

  const { member, shifts, attendance } = result.data;

  // Defense in depth: a lead must never see a member outside their group.
  if (!canViewMemberDetail(profile, member.workgroup)) {
    notFound();
  }

  const isManagement = isManagementRole(profile.role);
  const present = attendance.filter((record) => record.attended).length;
  const absent = attendance.length - present;

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
          </CardContent>
          <CardContent className="border-t pt-4 text-sm text-muted-foreground">
            <p>Fecha de alta: {DATE_FORMATTER.format(new Date(member.createdAt))}</p>
            {isManagement && member.birthDate && (
              <p className="mt-1">Fecha de nacimiento: {DATE_FORMATTER.format(new Date(member.birthDate))}</p>
            )}
          </CardContent>
        </Card>

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
