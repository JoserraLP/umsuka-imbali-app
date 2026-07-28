import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { isManagementRole, isAdminRole } from "@/lib/auth/roles";
import { listProfiles } from "@/lib/profiles/queries";
import { UserRoleSelect } from "@/app/admin/users/user-role-select";
import { MemberActiveToggle } from "@/app/admin/users/member-active-toggle";

export const metadata: Metadata = {
  title: "Miembros",
};

export default async function AdminUsersPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  // Server-side authorization gate (layer 2 of 3 — RLS on umsuka.profiles
  // is the authoritative layer regardless of this check).
  if (!isManagementRole(profile.role)) {
    redirect("/dashboard");
  }

  const members = await listProfiles();
  const canManage = isAdminRole(profile.role);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Miembros</h1>
          <p className="text-sm text-muted-foreground">
            Directorio de la asociación, roles (RBAC) y estado de alta/baja.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <DashboardNav currentRole={profile.role} />

      <Card>
        <CardHeader>
          <CardTitle>Directorio</CardTitle>
          <CardDescription>
            {canManage
              ? "Puedes editar, cambiar el rol y dar de alta/baja a cualquier miembro salvo a ti mismo."
              : "Solo los administradores pueden modificar miembros. Tienes acceso de solo lectura."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nombre</TableHead>
                <TableHead>Componente</TableHead>
                <TableHead>Rol</TableHead>
                <TableHead>Estado</TableHead>
                {canManage && <TableHead>Acciones</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const isSelf = member.id === profile.id;

                return (
                  <TableRow key={member.id}>
                    <TableCell className="font-medium">
                      {member.firstName} {member.lastName}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{member.componentType}</Badge>
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <UserRoleSelect
                          userId={member.id}
                          currentRole={member.role}
                          actorRole={profile.role}
                          disableSelf={isSelf}
                        />
                      ) : (
                        <Badge variant="secondary">{member.role}</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={member.isActive ? "default" : "destructive"}>
                        {member.isActive ? "Activo" : "Dado de baja"}
                      </Badge>
                    </TableCell>
                    {canManage && (
                      <TableCell>
                        <div className="flex flex-col gap-2 sm:flex-row">
                          <Button asChild variant="outline" size="sm">
                            <Link href={`/admin/users/${member.id}`}>Editar</Link>
                          </Button>
                          <MemberActiveToggle
                            userId={member.id}
                            isActive={member.isActive}
                            disableSelf={isSelf}
                          />
                        </div>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </main>
  );
}
