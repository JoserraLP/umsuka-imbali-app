import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { ACTIVE_WORKGROUPS, type ActiveWorkgroup } from "@/lib/workgroups/schema";
import { canViewGroupStats } from "@/lib/workgroups/stats";

export const metadata: Metadata = {
  title: "Estadísticas de grupos",
};

const WORKGROUP_LABELS: Record<ActiveWorkgroup, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
};

export default async function WorkgroupsPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  // Leads go straight to their own group's stats.
  if (canViewGroupStats(profile, profile.workgroup)) {
    if (profile.role !== "super_admin") {
      redirect(`/workgroups/${profile.workgroup}/stats`);
    }
  } else {
    redirect("/dashboard");
  }

  // Only super_admin reaches the index: a card per active workgroup.
  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Estadísticas de grupos</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Resumen de asistencia y horas por grupo de trabajo.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {ACTIVE_WORKGROUPS.map((workgroup) => (
            <Link key={workgroup} href={`/workgroups/${workgroup}/stats`}>
              <Card className="h-full transition-colors hover:border-brand/50">
                <CardHeader>
                  <CardTitle className="text-lg">{WORKGROUP_LABELS[workgroup]}</CardTitle>
                </CardHeader>
                <CardContent className="text-sm text-muted-foreground">
                  Ver estadísticas del grupo de {WORKGROUP_LABELS[workgroup]}.
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </div>
    </AppShell>
  );
}