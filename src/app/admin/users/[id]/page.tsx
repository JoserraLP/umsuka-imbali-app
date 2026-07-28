import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardNav } from "@/components/layout/dashboard-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
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

  // Server-side authorization gate (layer 2 of 3 — RLS on umsuka.profiles
  // is the authoritative layer regardless of this check). Editing
  // another member's data and activation status is restricted to
  // admin/super_admin, one level stricter than the read-only directory.
  if (!isAdminRole(actor.role)) {
    redirect("/admin/users");
  }

  const member = await getProfileById(id);

  if (!member) {
    notFound();
  }

  const isSelf = member.id === actor.id;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">
            {member.firstName} {member.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">
            Edición de perfil, rol y estado de alta/baja.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <DashboardNav currentRole={actor.role} />

      <div>
        <Link href="/admin/users" className="text-sm text-muted-foreground hover:text-foreground">
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
    </main>
  );
}
