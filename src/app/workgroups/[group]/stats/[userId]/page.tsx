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
import { activeWorkgroupSchema, type ActiveWorkgroup } from "@/lib/workgroups/schema";
import { canViewGroupStats } from "@/lib/workgroups/stats";
import { getMemberStatsAction } from "@/app/workgroups/actions";
import type { BarraTask } from "@/lib/workgroups/schema";

export const metadata: Metadata = {
  title: "Estadísticas del miembro",
};

interface PageProps {
  params: Promise<{ group: string; userId: string }>;
}

const WORKGROUP_LABELS: Record<ActiveWorkgroup, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
};

const BARRATASK_LABELS: Record<BarraTask, string> = {
  cocina: "Cocina",
  bebidas: "Bebidas",
};

const PERCENT_FORMATTER = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});

const SHIFT_DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
  timeStyle: "short",
});

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${PERCENT_FORMATTER.format(value)} %`;
}

export default async function MemberStatsPage({ params }: PageProps) {
  const { group, userId } = await params;

  const parsed = activeWorkgroupSchema.safeParse(group);
  if (!parsed.success) {
    notFound();
  }

  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  if (!canViewGroupStats(profile, parsed.data)) {
    redirect("/dashboard");
  }

  const result = await getMemberStatsAction(parsed.data, userId);

  if (!result.success || !result.data) {
    notFound();
  }

  const detail = result.data;

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">
            {detail.firstName} {detail.lastName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Estadísticas en el grupo {WORKGROUP_LABELS[detail.workgroup]}.
          </p>
          <Link
            href={`/workgroups/${parsed.data}/stats`}
            className="mt-2 inline-block text-sm text-muted-foreground hover:text-foreground"
          >
            ← Volver a estadísticas del grupo
          </Link>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Turnos asignados</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{detail.assignedShifts}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Turnos asistidos</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">{detail.attendedShifts}</CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Horas totales</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">
              {PERCENT_FORMATTER.format(detail.totalHours)}
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">% asistencia</CardTitle>
            </CardHeader>
            <CardContent className="text-2xl font-bold">
              {formatPercent(detail.attendanceRate)}
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Desglose de turnos</CardTitle>
            <CardDescription>Registros de asistencia del miembro en el grupo.</CardDescription>
          </CardHeader>
          <CardContent>
            {detail.shifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay turnos registrados para este miembro.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Turno</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Fecha turno</TableHead>
                    <TableHead>Asistió</TableHead>
                    <TableHead>Horas</TableHead>
                    <TableHead>Tarea</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {detail.shifts.map((shift) => (
                    <TableRow key={shift.attendanceId}>
                      <TableCell className="font-medium">{shift.shiftName}</TableCell>
                      <TableCell>
                        {shift.eventId ? (
                          <Link
                            href={`/events/${shift.eventId}`}
                            className="hover:underline hover:text-primary"
                          >
                            {shift.eventTitle}
                          </Link>
                        ) : (
                          shift.eventTitle
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {shift.startTime
                          ? SHIFT_DATE_FORMATTER.format(new Date(shift.startTime))
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {shift.attended ? (
                          <Badge className="bg-green-100 text-green-700">Sí</Badge>
                        ) : (
                          <Badge variant="destructive">No</Badge>
                        )}
                      </TableCell>
                      <TableCell>{PERCENT_FORMATTER.format(shift.hours)}</TableCell>
                      <TableCell>
                        {shift.barraTask ? (
                          <Badge variant="outline">{BARRATASK_LABELS[shift.barraTask]}</Badge>
                        ) : (
                          "—"
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