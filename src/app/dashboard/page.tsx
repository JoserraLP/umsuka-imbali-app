import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardNav } from "@/components/layout/dashboard-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { getCurrentProfile } from "@/lib/auth/session";
import { signOutAction } from "@/app/dashboard/actions";

export const metadata: Metadata = {
  title: "Panel de control",
};

export default async function DashboardPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Umsuka Imbali</h1>
          <p className="text-sm text-muted-foreground">Panel principal.</p>
        </div>
        <ThemeToggle />
      </header>

      <DashboardNav currentRole={profile.role} />

      <Card>
        <CardHeader>
          <CardTitle>
            Bienvenido/a, {profile.firstName} {profile.lastName}
          </CardTitle>
          <CardDescription className="flex items-center gap-2">
            {profile.email ?? "correo desconocido"}
            <Badge variant="secondary">{profile.role}</Badge>
            <Badge variant="outline">{profile.componentType}</Badge>
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-sm text-muted-foreground">
            Próximamente aquí verás tus eventos, inscripciones, asistencia y turnos
            asignados. De momento puedes gestionar tu perfil y, si tienes permisos,
            el directorio de miembros.
          </p>
          <form action={signOutAction}>
            <Button type="submit" variant="outline">
              Cerrar sesión
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
