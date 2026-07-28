import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { AppShell } from "@/components/layout/app-shell";
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
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">
            Bienvenido/a, {profile.firstName}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Panel principal de Umsuka Imbali.
          </p>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="flex items-center gap-3">
            <Badge variant="secondary">{profile.role}</Badge>
            <Badge variant="outline">{profile.componentType}</Badge>
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            Próximamente aquí verás tus eventos, inscripciones, asistencia y turnos
            asignados. De momento puedes gestionar tu perfil y, si tienes permisos,
            el directorio de miembros.
          </p>
        </div>

        <div className="rounded-xl border bg-card p-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="font-semibold">Tu sesión</h2>
              <p className="text-sm text-muted-foreground">{profile.email ?? "correo desconocido"}</p>
            </div>
            <form action={signOutAction}>
              <Button type="submit" variant="outline" size="sm">
                Cerrar sesión
              </Button>
            </form>
          </div>
        </div>
      </div>
    </AppShell>
  );
}
