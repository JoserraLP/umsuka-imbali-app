import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
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
import { TrendChart } from "@/components/stats/trend-chart";
import { ComparisonBars } from "@/components/stats/comparison-bars";
import { getCurrentProfile } from "@/lib/auth/session";
import { getUserAttendance } from "@/lib/attendance/queries";
import { getUserAbsences } from "@/lib/absences/queries";
import { getPersonalActivityMarks, getMyWorkgroupShiftAverage } from "@/lib/stats/queries";
import { buildPersonalStats } from "@/lib/stats/stats";

export const metadata: Metadata = {
  title: "Estadísticas",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
  timeStyle: "short",
});

/** Formats a percentage ("66.7%") or an em dash when there is no data. */
function formatRate(rate: number | null): string {
  return rate === null ? "—" : `${rate}%`;
}

export default async function StatsPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const [marks, groupAverage] = await Promise.all([
    getPersonalActivityMarks(profile.id),
    getMyWorkgroupShiftAverage(),
  ]);

  const stats = buildPersonalStats(
    marks.eventMarks,
    marks.rehearsalMarks,
    marks.shiftMarks,
  );

  const [attendanceRecords, absenceRecords] = await Promise.all([
    getUserAttendance(profile.id),
    getUserAbsences(profile.id),
  ]);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Estadísticas</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Rachas y porcentajes calculados sobre tus actividades marcadas
            (eventos, ensayos y turnos).
          </p>
          <Link
            href="/profile"
            className="mt-2 inline-block text-sm text-muted-foreground hover:text-foreground"
          >
            ← Volver a mi perfil
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
          <StatTile label="% Eventos" value={formatRate(stats.eventRate)} />
          <StatTile label="% Ensayos" value={formatRate(stats.rehearsalRate)} />
          <StatTile label="% Turnos" value={formatRate(stats.shiftRate)} />
          <StatTile label="Racha actual" value={String(stats.streaks.current)} />
          <StatTile label="Mejor racha" value={String(stats.streaks.best)} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Tendencia (últimos 6 meses)</CardTitle>
            <CardDescription>
              Porcentaje de asistencia por mes sobre todas tus actividades marcadas.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TrendChart points={stats.trend} />
          </CardContent>
        </Card>

        {profile.workgroup !== "ninguno" && (
          <Card>
            <CardHeader>
              <CardTitle>Comparativa con mi grupo</CardTitle>
              <CardDescription>
                Tu asistencia a turnos frente a la media de tu grupo de trabajo.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ComparisonBars mine={stats.shiftRate} average={groupAverage} />
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Historial de asistencia</CardTitle>
            <CardDescription>
              Registros de eventos a los que has asistido.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {attendanceRecords.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay registros de asistencia.
              </p>
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
                  {attendanceRecords.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/events/${record.eventId}`}
                          className="hover:underline"
                        >
                          {record.eventTitle}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {record.eventDate
                          ? DATE_FORMATTER.format(new Date(record.eventDate))
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {record.attended ? (
                          <Badge className="bg-green-100 text-green-700">
                            Sí
                          </Badge>
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

        <Card>
          <CardHeader>
            <CardTitle>Ausencias solicitadas</CardTitle>
            <CardDescription>
              Solicitudes de ausencia que has realizado.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {absenceRecords.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No hay registros de ausencias.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Evento</TableHead>
                    <TableHead>Fecha del evento</TableHead>
                    <TableHead>Motivo</TableHead>
                    <TableHead>Justificada</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {absenceRecords.map((record) => (
                    <TableRow key={record.id}>
                      <TableCell className="font-medium">
                        <Link
                          href={`/events/${record.eventId}`}
                          className="hover:underline"
                        >
                          {record.eventTitle}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {record.eventDate
                          ? DATE_FORMATTER.format(new Date(record.eventDate))
                          : "—"}
                      </TableCell>
                      <TableCell className="max-w-xs truncate text-muted-foreground">
                        {record.reason ?? "—"}
                      </TableCell>
                      <TableCell>
                        {record.justified ? (
                          <Badge className="bg-green-100 text-green-700">
                            Sí
                          </Badge>
                        ) : (
                          <Badge variant="secondary">No</Badge>
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

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-md border border-border p-4 text-center">
      <span className="text-2xl font-bold">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}
