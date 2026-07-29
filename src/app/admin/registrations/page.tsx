import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { listPendingProfiles } from "@/lib/approvals/queries";
import { ApproveUserButton } from "@/app/admin/registrations/approve-button";
import { SuspendUserButton } from "@/app/admin/registrations/suspend-button";

export const metadata: Metadata = {
  title: "Aprobaciones de registro",
};

export default async function AdminRegistrationsPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  if (!isAdminRole(profile.role)) {
    redirect("/dashboard");
  }

  const pendingUsers = await listPendingProfiles();

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Aprobaciones de registro</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Usuarios que se han registrado y esperan la aprobación de un administrador.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Pendientes ({pendingUsers.length})</CardTitle>
            <CardDescription>
              Revisa los datos del usuario y decide si apruebas o suspendes su solicitud.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {pendingUsers.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No hay solicitudes de registro pendientes.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nombre</TableHead>
                    <TableHead>Componente</TableHead>
                    <TableHead>Rol</TableHead>
                    <TableHead>Estado</TableHead>
                    <TableHead>Acciones</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pendingUsers.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell className="font-medium">
                        {member.firstName} {member.lastName}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{member.componentType}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">{member.role}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="secondary">Pendiente</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <ApproveUserButton userId={member.id} />
                          <SuspendUserButton userId={member.id} />
                        </div>
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
