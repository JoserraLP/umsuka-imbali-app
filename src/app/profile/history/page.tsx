import type { Metadata } from "next";
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
import { DashboardNav } from "@/components/layout/dashboard-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { getCurrentProfile } from "@/lib/auth/session";
import { getUserAttendance } from "@/lib/attendance/queries";
import { getUserAbsences } from "@/lib/absences/queries";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Historial de asistencia",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function HistoryPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const [attendanceRecords, absenceRecords] = await Promise.all([
    getUserAttendance(profile.id),
    getUserAbsences(profile.id),
  ]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Historial</h1>
          <p className="text-sm text-muted-foreground">
            Tu historial de asistencia y ausencias.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <DashboardNav currentRole={profile.role} />

      <div>
        <Link href="/profile" className="text-sm text-muted-foreground hover:text-foreground">
          ← Volver a mi perfil
        </Link>
      </div>

      {/* Attendance History */}
      <Card>
        <CardHeader>
          <CardTitle>Asistencia</CardTitle>
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

      {/* Absences History */}
      <Card>
        <CardHeader>
          <CardTitle>Ausencias</CardTitle>
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
    </main>
  );
}
