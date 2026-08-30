import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { getReunionEvents } from "@/lib/meetings/queries";
import { FileText, FileCheck, CalendarDays, MapPin, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

export const metadata: Metadata = { title: "Actas de reuniones" };

interface PageProps {
  searchParams: Promise<{ q?: string; from?: string; to?: string }>;
}

export default async function ActasPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth/login");

  const params = await searchParams;
  const q = params.q?.trim() || undefined;
  const from = params.from || undefined;
  const to = params.to || undefined;

  const events = await getReunionEvents({ search: q, fromDate: from, toDate: to, limit: 50 });

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
            <FileText className="h-6 w-6" /> Actas de reuniones
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Todas las reuniones registradas. Indicador si tienen acta (sin descarga en esta fase).
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Search className="h-4 w-4" /> Filtros
            </CardTitle>
            <CardDescription>Filtra por título y rango de fechas.</CardDescription>
          </CardHeader>
          <CardContent>
            <form method="GET" className="flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1">
                <label htmlFor="q" className="text-xs font-medium text-muted-foreground">
                  Buscar por título
                </label>
                <Input id="q" name="q" defaultValue={q} placeholder="Ej. Reunión junta..." className="mt-1" />
              </div>
              <div>
                <label htmlFor="from" className="text-xs font-medium text-muted-foreground">
                  Desde
                </label>
                <Input id="from" name="from" type="date" defaultValue={from} className="mt-1" />
              </div>
              <div>
                <label htmlFor="to" className="text-xs font-medium text-muted-foreground">
                  Hasta
                </label>
                <Input id="to" name="to" type="date" defaultValue={to} className="mt-1" />
              </div>
              <button type="submit" className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Filtrar
              </button>
              {(q || from || to) && (
                <Link href="/actas" className="text-sm text-muted-foreground hover:text-foreground">
                  Limpiar
                </Link>
              )}
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Reuniones ({events.length})</CardTitle>
            <CardDescription>Ordenadas por fecha descendente. Verde = con acta, gris = sin acta.</CardDescription>
          </CardHeader>
          <CardContent>
            {events.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CalendarDays className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-sm text-muted-foreground">No hay reuniones con esos filtros.</p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {events.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-3 py-3">
                    <div className="min-w-0 flex-1">
                      <Link href={`/events/${e.id}`} className="text-sm font-medium hover:underline">
                        {e.title}
                      </Link>
                      <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <CalendarDays className="h-3 w-3" />
                          {new Date(e.eventDate).toLocaleDateString("es-ES", { dateStyle: "medium" })}
                        </span>
                        {e.location && (
                          <span className="flex items-center gap-1">
                            <MapPin className="h-3 w-3" /> {e.location}
                          </span>
                        )}
                      </div>
                      {e.minutes && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {e.minutes.fileName} · {(e.minutes.fileSize / 1024).toFixed(1)} KB
                        </p>
                      )}
                    </div>
                    <div className="shrink-0">
                      {e.hasMinutes ? (
                        <Badge variant="default" className="gap-1">
                          <FileCheck className="h-3 w-3" /> Con acta
                        </Badge>
                      ) : (
                        <Badge variant="outline" className="gap-1">
                          <FileText className="h-3 w-3" /> Sin acta
                        </Badge>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
