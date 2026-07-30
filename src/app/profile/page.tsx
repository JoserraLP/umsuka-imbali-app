import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { ProfileForm } from "@/app/profile/profile-form";
import { ChangePasswordForm } from "@/app/profile/change-password-form";

export const metadata: Metadata = {
  title: "Mi perfil",
};

export default async function ProfilePage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Mi perfil</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Consulta y edita tu información personal.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Datos personales</CardTitle>
            <CardDescription className="flex items-center gap-2">
              {profile.email ?? "correo desconocido"}
              <Badge variant="secondary">{profile.role}</Badge>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProfileForm
              defaultValues={{
                firstName: profile.firstName,
                lastName: profile.lastName,
                birthDate: profile.birthDate ?? "",
                componentType: profile.componentType,
              }}
            />
          </CardContent>
        </Card>

        {profile.authMethod === "email_alias" && (
          <Card>
            <CardHeader>
              <CardTitle>Contraseña</CardTitle>
              <CardDescription>
                Cambia tu contraseña de acceso. Se recomienda actualizarla periódicamente.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ChangePasswordForm />
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
