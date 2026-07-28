import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardNav } from "@/components/layout/dashboard-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { getCurrentProfile } from "@/lib/auth/session";
import { ProfileForm } from "@/app/profile/profile-form";

export const metadata: Metadata = {
  title: "Mi perfil",
};

export default async function ProfilePage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Mi perfil</h1>
          <p className="text-sm text-muted-foreground">
            Consulta y edita tu información personal.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <DashboardNav currentRole={profile.role} />

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
    </main>
  );
}
