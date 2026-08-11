import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isAdminRole } from "@/lib/auth/roles";
import { getProfileById } from "@/lib/profiles/queries";
import { MemberEditForm } from "@/app/admin/users/[id]/member-edit-form";
import { UserRoleSelect } from "@/app/admin/users/user-role-select";
import { MemberActiveToggle } from "@/app/admin/users/member-active-toggle";

export const metadata: Metadata = {
  title: "Editar miembro",
};

interface AdminUserDetailPageProps {
  params: Promise<{ id: string }>;
}

export default async function AdminUserDetailPage({ params }: AdminUserDetailPageProps) {
  const { id } = await params;
  const actor = await getCurrentProfile();

  if (!actor) {
    redirect("/auth/login");
  }

  if (!isAdminRole(actor.role)) {
    redirect("/admin/users");
  }

  const member = await getProfileById(id);

  if (!member) {
    notFound();
  }

  const isSelf = member.id === actor.id;

  return (
    <AppShell profile={actor}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">
            {member.firstName} {member.lastName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Edición de perfil, rol y estado de alta/baja.
          </p>
          <Link href="/admin/users" className="mt-2 inline-block text-sm text-muted-foreground hover:text-foreground">
            ← Volver al directorio
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Datos personales</CardTitle>
            <CardDescription className="flex items-center gap-2">
              <Badge variant="secondary">{member.role}</Badge>
              <Badge variant={member.isActive ? "default" : "destructive"}>
                {member.isActive ? "Activo" : "Dado de baja"}
              </Badge>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MemberEditForm
              defaultValues={{
                userId: member.id,
                firstName: member.firstName,
                lastName: member.lastName,
                birthDate: member.birthDate ?? "",
                componentType: member.componentType,
                workgroup: member.workgroup,
              }}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rol (RBAC)</CardTitle>
            <CardDescription>
              Solo un super_admin puede otorgar o revocar super_admin/admin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <UserRoleSelect
              userId={member.id}
              currentRole={member.role}
              actorRole={actor.role}
              disableSelf={isSelf}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Alta / Baja</CardTitle>
            <CardDescription>
              Dar de baja desactiva el acceso a la aplicación sin borrar su historial.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <MemberActiveToggle userId={member.id} isActive={member.isActive} disableSelf={isSelf} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
