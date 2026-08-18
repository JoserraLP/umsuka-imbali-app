import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { hasPermission } from "@/lib/admin/permissions";
import { listSettings } from "@/lib/admin/queries";
import { SettingsForm } from "@/app/admin/settings/settings-form";

export const metadata: Metadata = {
  title: "Configuración",
};

export default async function AdminSettingsPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  if (!hasPermission(profile.role, "settings.read")) {
    redirect("/dashboard");
  }

  const settings = await listSettings();

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Configuración</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Ajustes globales de la asociación visibles en toda la aplicación.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Parámetros generales</CardTitle>
            <CardDescription>
              Cambios visibles para todos los miembros. Cada guardado queda registrado en el
              historial de auditoría.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <SettingsForm initialSettings={settings} />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}