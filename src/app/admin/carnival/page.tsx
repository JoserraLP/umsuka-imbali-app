import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getActiveYear, getCarnivalYears } from "@/lib/carnival/queries";
import { CarnivalYearForm } from "@/app/admin/carnival/carnival-year-form";

export const metadata: Metadata = { title: "Año de Carnaval" };

export default async function CarnivalPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth/login");
  if (!isManagementRole(profile.role)) redirect("/dashboard");

  const [active, years] = await Promise.all([getActiveYear().catch(() => null), getCarnivalYears().catch(() => [])]);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Año de Carnaval</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Inicia un nuevo año: archiva el anterior y guarda una copia de seguridad completa sin borrar el histórico.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Año activo</CardTitle>
            <CardDescription>Solo puede haber un año activo. Al iniciar uno nuevo, el actual se archiva.</CardDescription>
          </CardHeader>
          <CardContent>
            {active ? (
              <div className="flex flex-col gap-2">
                <div className="flex items-center gap-2">
                  <Badge variant="default">{active.label}</Badge>
                  <Badge variant="outline">Año {active.year}</Badge>
                  <Badge variant="secondary">Activo</Badge>
                </div>
                <p className="text-sm text-muted-foreground">Inicio: {new Date(active.startDate).toLocaleDateString("es-ES")}</p>
                <p className="text-xs text-muted-foreground">ID: {active.id}</p>
                <Link href="/admin/carnival/history" className="text-sm text-primary hover:underline">
                  Ver histórico →
                </Link>
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No hay año activo. Crea uno nuevo abajo.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Iniciar nuevo año de carnaval</CardTitle>
            <CardDescription>
              Se archivará el año activo y se creará una copia en <code>carnival_year_snapshots</code> + <code>carnival-backups/&lt;year&gt;.json</code> con: estadísticas, formaciones, preguntas, miembros, pagos, asistencias, turnos, votaciones, eventos, instrumentos y dinero de la comparsa. Luego se reinician los contadores del nuevo año a 0.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <CarnivalYearForm />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Todos los años ({years.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {years.map((y) => (
                <li key={y.id} className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-medium">{y.label} — {y.year}</p>
                    <p className="text-xs text-muted-foreground">{new Date(y.startDate).toLocaleDateString("es-ES")} {y.endDate ? `→ ${new Date(y.endDate).toLocaleDateString("es-ES")}` : ""}</p>
                  </div>
                  <Badge variant={y.status === "active" ? "default" : "secondary"}>{y.status === "active" ? "Activo" : "Archivado"}</Badge>
                </li>
              ))}
              {years.length === 0 && <p className="text-sm text-muted-foreground">Sin años.</p>}
            </ul>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
