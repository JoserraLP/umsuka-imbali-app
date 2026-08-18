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
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasPermission } from "@/lib/admin/permissions";
import { listUsersOverview } from "@/lib/admin/queries";
import { UserRoleSelect } from "@/app/admin/users/user-role-select";
import { MemberComponentTypeSelect } from "@/app/admin/users/member-component-type-select";
import { MemberWorkgroupSelect } from "@/app/admin/users/member-workgroup-select";
import { MemberComponentLeadSelect } from "@/app/admin/users/member-component-lead-select";
import { MemberActiveToggle } from "@/app/admin/users/member-active-toggle";
import { EmaillessAccountForm } from "@/app/admin/users/emailless-account-form";
import { ResetPasswordButton } from "@/app/admin/users/reset-password-button";
import { UnlockAccountButton } from "@/app/admin/users/unlock-account-button";
import { UserStatusActions } from "@/app/admin/users/user-status-actions";
import { ScrollText } from "lucide-react";

export const metadata: Metadata = {
  title: "Administración de miembros",
};

/** Fecha de registro legible (ej. "18 ago 2026"). */
function formatJoinDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export default async function AdminUsersPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  if (!hasPermission(profile.role, "users.read")) {
    redirect("/dashboard");
  }

  const members = await listUsersOverview();
  const canManage = hasPermission(profile.role, "users.manage");

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Administración de miembros</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Gestión de los miembros de la asociación: roles (RBAC) y estado de alta/baja.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Listado</CardTitle>
            <CardDescription>
              {canManage
                ? "Puedes editar, cambiar el rol, aprobar/suspender y dar de alta/baja a cualquier miembro salvo a ti mismo."
                : "Solo los administradores pueden modificar miembros. Tienes acceso de solo lectura."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nombre</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Componente</TableHead>
                  <TableHead>Grupo de trabajo</TableHead>
                  <TableHead>Rol</TableHead>
                  <TableHead>Responsable</TableHead>
                  <TableHead>Estado</TableHead>
                  <TableHead>Fecha de registro</TableHead>
                  <TableHead>Alta/Baja</TableHead>
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
                        {/* Emails enmascarados vía get_user_emails; las
                            cuentas sin email (aliases @umsuka.internal)
                            llegan null y se muestran como "—". */}
                        <span className="text-sm text-muted-foreground">
                          {member.email ?? "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        {canManage ? (
                          <MemberComponentTypeSelect
                            userId={member.id}
                            currentType={member.componentType}
                            disableSelf={isSelf}
                          />
                        ) : (
                          <Badge variant="outline">{member.componentType}</Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {profile.role === "super_admin" ? (
                          <MemberWorkgroupSelect
                            userId={member.id}
                            currentWorkgroup={member.workgroup}
                            requiresWorkgroup={
                              member.componentType === "music" || member.componentType === "dance"
                            }
                          />
                        ) : (
                          <Badge variant="outline">{member.workgroup}</Badge>
                        )}
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
                        {profile.role === "super_admin" ? (
                          <MemberComponentLeadSelect
                            // Key includes the current value so the client
                            // select re-syncs after revalidation when the
                            // cargo moves to/from another row.
                            key={`${member.id}:${member.componentLeadFor ?? "none"}`}
                            userId={member.id}
                            currentLead={member.componentLeadFor}
                            disableSelf={isSelf}
                          />
                        ) : (
                          <Badge variant="outline">
                            {member.componentLeadFor === "music"
                              ? "Música"
                              : member.componentLeadFor === "dance"
                                ? "Baile"
                                : "—"}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            member.status === "active"
                              ? "default"
                              : member.status === "pending"
                                ? "secondary"
                                : "destructive"
                          }
                        >
                          {member.status === "active"
                            ? "Activo"
                            : member.status === "pending"
                              ? "Pendiente"
                              : "Suspendido"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <span className="whitespace-nowrap text-sm text-muted-foreground">
                          {formatJoinDate(member.createdAt)}
                        </span>
                      </TableCell>
                      <TableCell>
                        <Badge variant={member.isActive ? "default" : "destructive"}>
                          {member.isActive ? "Alta" : "Baja"}
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
                            <UserStatusActions
                              userId={member.id}
                              status={member.status}
                              disableSelf={isSelf}
                            />
                            {member.authMethod === "email_alias" && !isSelf && (
                              <ResetPasswordButton
                                profileId={member.id}
                                username={
                                  member.username ?? `${member.firstName} ${member.lastName}`
                                }
                              />
                            )}
                            {profile.role === "super_admin" && !isSelf && (
                              <UnlockAccountButton
                                profileId={member.id}
                                username={
                                  member.username ?? `${member.firstName} ${member.lastName}`
                                }
                              />
                            )}
                            <Button asChild variant="ghost" size="sm" title="Ver logs de auditoría">
                              <Link href={`/admin/audit?user=${member.id}`}>
                                <ScrollText className="mr-1 h-4 w-4" />
                                Ver logs
                              </Link>
                            </Button>
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

        {profile.role === "super_admin" && (
          <Card>
            <CardHeader>
              <CardTitle>Crear cuenta sin correo electrónico</CardTitle>
              <CardDescription>
                Crea cuentas para miembros que no tengan email (ej. menores de edad). El sistema
                genera un identificador interno y el miembro accede con usuario y contraseña. La
                cuenta se crea en estado pendiente — un administrador debe aprobarla antes de que
                pueda acceder.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EmaillessAccountForm />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
