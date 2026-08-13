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
import { getGroupStatsAction } from "@/app/workgroups/actions";
import type { GroupMemberStat } from "@/lib/workgroups/stats";

export const metadata: Metadata = {
  title: "Estadísticas del grupo",
};

interface PageProps {
  params: Promise<{ group: string }>;
}

const WORKGROUP_LABELS: Record<ActiveWorkgroup, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
};

const PERCENT_FORMATTER = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 1,
  maximumFractionDigits: 1,
});
const HOURS_FORMATTER = new Intl.NumberFormat("es-ES", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

function formatPercent(value: number | null): string {
  return value === null ? "—" : `${PERCENT_FORMATTER.format(value)} %`;
}

function formatHours(value: number): string {
  return HOURS_FORMATTER.format(value);
}

export default async function WorkgroupStatsPage({ params }: PageProps) {
  const { group } = await params;

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

  const result = await getGroupStatsAction(parsed.data);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">
            Estadísticas · {WORKGROUP_LABELS[parsed.data]}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Asistencia y horas de los miembros del grupo.
          </p>
          {profile.role === "super_admin" && (
            <Link
              href="/workgroups"
              className="mt-2 inline-block text-sm text-muted-foreground hover:text-foreground"
            >
              ← Volver a estadísticas de grupos
            </Link>
          )}
        </div>

        {!result.success && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {result.error}
          </div>
        )}

        <div className="rounded-lg border border-brand/30 bg-brand/5 px-4 py-3 text-sm">
          Las horas de barra se calculan por duración del turno. El porcentaje se calcula sobre
          turnos marcados.
        </div>

        {result.success && (
          <Card>
            <CardHeader>
              <CardTitle>Miembros del grupo</CardTitle>
              <CardDescription>
                {result.data.members.length === 0
                  ? "Sin miembros."
                  : `${result.data.members.length} miembros.`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {result.data.members.length === 0 ? (
                <p className="text-sm text-muted-foreground">No hay miembros en este grupo.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nombre</TableHead>
                      <TableHead>Turnos asignados</TableHead>
                      <TableHead>Turnos asistidos</TableHead>
                      <TableHead>Horas totales</TableHead>
                      <TableHead>% asistencia</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.data.members.map((member: GroupMemberStat) => (
                      <TableRow key={member.userId}>
                        <TableCell className="font-medium">
                          <Link
                            href={`/workgroups/${parsed.data}/stats/${member.userId}`}
                            className="hover:underline hover:text-primary"
                          >
                            {member.firstName} {member.lastName}
                          </Link>
                        </TableCell>
                        <TableCell>{member.assignedShifts}</TableCell>
                        <TableCell>{member.attendedShifts}</TableCell>
                        <TableCell>{formatHours(member.totalHours)}</TableCell>
                        <TableCell>
                          {member.attendanceRate === null ? (
                            "—"
                          ) : (
                            <Badge variant="secondary">{formatPercent(member.attendanceRate)}</Badge>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}