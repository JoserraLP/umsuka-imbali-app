import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { getMyAssignedShifts } from "@/lib/shifts/assignments";

export const metadata: Metadata = {
  title: "Mis turnos",
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  dateStyle: "medium",
});

const TIME_FORMATTER = new Intl.DateTimeFormat("es-ES", {
  hour: "2-digit",
  minute: "2-digit",
});

export default async function ProfileShiftsPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const shifts = await getMyAssignedShifts(profile.id);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Mis turnos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Turnos a los que has sido asignado.
          </p>
          <Link
            href="/profile"
            className="mt-2 inline-block text-sm text-muted-foreground hover:text-foreground"
          >
            ← Volver a mi perfil
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Turnos asignados</CardTitle>
            <CardDescription>
              {shifts.length === 0
                ? "No tienes turnos asignados."
                : `Tienes ${shifts.length} turno${shifts.length === 1 ? "" : "s"} asignado${shifts.length === 1 ? "" : "s"}.`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {shifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tienes turnos asignados.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Turno</TableHead>
                    <TableHead>Evento</TableHead>
                    <TableHead>Fecha del evento</TableHead>
                    <TableHead>Inicio</TableHead>
                    <TableHead>Fin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shifts.map((s) => (
                    <TableRow key={s.shiftId}>
                      <TableCell className="font-medium">{s.shiftName}</TableCell>
                      <TableCell>
                        <Link
                          href={`/events/${s.eventId}`}
                          className="hover:underline"
                        >
                          {s.eventTitle}
                        </Link>
                      </TableCell>
                      <TableCell>
                        {s.eventDate
                          ? DATE_FORMATTER.format(new Date(s.eventDate))
                          : "—"}
                      </TableCell>
                      <TableCell>
                        {TIME_FORMATTER.format(new Date(s.startTime))}
                      </TableCell>
                      <TableCell>
                        {TIME_FORMATTER.format(new Date(s.endTime))}
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
