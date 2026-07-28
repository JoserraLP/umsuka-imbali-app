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
import { AppShell } from "@/components/layout/app-shell";
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
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Historial</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Tu historial de asistencia y ausencias.
          </p>
          <Link href="/profile" className="mt-2 inline-block text-sm text-muted-foreground hover:text-foreground">
            ← Volver a mi perfil
          </Link>
        </div>

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
      </div>
    </AppShell>
  );
}
