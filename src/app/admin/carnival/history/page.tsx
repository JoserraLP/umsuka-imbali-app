import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getCarnivalYears, getSnapshotsByYearId } from "@/lib/carnival/queries";

export const metadata: Metadata = { title: "Histórico de Copias" };

interface PageProps {
  searchParams: Promise<{ yearId?: string }>;
}

export default async function CarnivalHistoryPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth/login");
  if (!isManagementRole(profile.role)) redirect("/dashboard");

  const { yearId } = await searchParams;
  const years = await getCarnivalYears().catch(() => []);
  const archived = years.filter((y) => y.status === "archived");
  const selectedYearId = yearId ?? archived[0]?.id ?? null;
  const snapshots = selectedYearId ? await getSnapshotsByYearId(selectedYearId).catch(() => []) : [];
  const selectedYear = years.find((y) => y.id === selectedYearId) ?? null;

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Histórico de copias</h1>
          <p className="mt-1 text-sm text-muted-foreground">Consulta las copias de seguridad por año, por secciones, y descarga el backup JSON.</p>
          <Link href="/admin/carnival" className="mt-2 inline-block text-sm text-primary hover:underline">
            ← Volver a Año de Carnaval
          </Link>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Años archivados ({archived.length})</CardTitle>
            <CardDescription>Selecciona un año para ver su snapshot.</CardDescription>
          </CardHeader>
          <CardContent>
            {archived.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay años archivados.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {archived.map((y) => (
                  <Link
                    key={y.id}
                    href={`/admin/carnival/history?yearId=${y.id}`}
                    className={`rounded-md border px-3 py-1.5 text-sm ${selectedYearId === y.id ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}
                  >
                    {y.label} ({y.year})
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {selectedYear && (
          <Card>
            <CardHeader>
              <CardTitle>Copia: {selectedYear.label}</CardTitle>
              <CardDescription>
                Año {selectedYear.year} · Cerrado {selectedYear.endDate ? new Date(selectedYear.endDate).toLocaleDateString("es-ES") : ""} · {snapshots.length} secciones
              </CardDescription>
            </CardHeader>
            <CardContent>
              {snapshots.length === 0 ? (
                <p className="text-sm text-muted-foreground">Sin snapshots para este año.</p>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2">
                  {snapshots.map((s) => {
                    const arr = Array.isArray(s.data) ? (s.data as unknown[]) : [];
                    return (
                      <div key={s.id} className="rounded-md border p-3">
                        <div className="flex items-center justify-between">
                          <p className="text-sm font-medium">{s.snapshotType}</p>
                          <Badge variant="outline">{arr.length} registros</Badge>
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">Snapshot del {new Date(s.createdAt).toLocaleDateString("es-ES")}</p>
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs text-primary hover:underline">Ver JSON</summary>
                          <pre className="mt-2 max-h-48 overflow-auto rounded bg-muted p-2 text-xs">{JSON.stringify(s.data, null, 2).slice(0, 4000)}{JSON.stringify(s.data).length > 4000 ? "\n… truncado" : ""}</pre>
                        </details>
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="mt-4">
                <p className="text-xs text-muted-foreground">
                  Backup en Storage: <code>carnival-backups/{selectedYear.year}.json</code> (descarga vía Supabase Storage API, solo directiva).
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
