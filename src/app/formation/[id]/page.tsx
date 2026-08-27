import type { Metadata } from "next";
import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getFormationById, getAvailableDancers, getAvailableMusicians, getAvailableInstruments, getMusicianInstruments } from "@/lib/formation/queries";
import { DanceFormationGrid } from "@/components/formation/DanceFormationGrid";
import { MusicianInstrumentList } from "@/components/formation/MusicianInstrumentList";

export const metadata: Metadata = { title: "Formación" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function FormationDetailPage({ params }: Props) {
  const { id } = await params;
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth/login");

  const formation = await getFormationById(id);
  if (!formation) notFound();

  const canManage = isManagementRole(profile.role);
  const isReadOnly = !canManage;

  // Fetch only needed data per type to avoid leaking other component data
  const isDance = formation.formationType === "dance";
  const [dancers, musicians, instruments, assignments] = await Promise.all([
    isDance ? getAvailableDancers() : Promise.resolve([] as Awaited<ReturnType<typeof getAvailableDancers>>),
    !isDance ? getAvailableMusicians() : Promise.resolve([] as Awaited<ReturnType<typeof getAvailableMusicians>>),
    !isDance ? getAvailableInstruments(formation.id) : Promise.resolve([] as Awaited<ReturnType<typeof getAvailableInstruments>>),
    !isDance ? getMusicianInstruments(formation.id) : Promise.resolve([] as Awaited<ReturnType<typeof getMusicianInstruments>>),
  ]);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <Link href="/formation" className="text-sm text-muted-foreground hover:text-foreground">
            ← Volver a formaciones
          </Link>
          <div className="flex items-center gap-2">
            <h1 className="mt-2 text-xl font-bold tracking-tight">{formation.name}</h1>
            <span className={`mt-2 rounded-full px-2 py-0.5 text-xs font-medium ${formation.formationType === "dance" ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground"}`}>
              {formation.formationType === "dance" ? "Baile" : "Música"}
            </span>
          </div>
          <p className="text-sm text-muted-foreground">
            {formation.eventId ? `Ligada a evento ${formation.eventId.slice(0, 8)}…` : "Formación base (sin evento)"} ·{" "}
            {new Date(formation.createdAt).toLocaleDateString("es-ES")} · {formation.formationType === "dance" ? "6 por fila, juntas" : "Instrumentos por músico"}
          </p>
        </div>

        {isDance ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Bailarinas — 6 por fila</CardTitle>
              <CardDescription>Todas juntas sin pasillo. {isReadOnly ? "Solo lectura." : "Haz clic para asignar/mover. Añade filas con el botón."}</CardDescription>
            </CardHeader>
            <CardContent>
              <DanceFormationGrid formation={formation} availableDancers={dancers} isReadOnly={isReadOnly} />
            </CardContent>
          </Card>
        ) : (
          <MusicianInstrumentList
            formationId={formation.id}
            musicians={musicians.map((m) => ({ id: m.id, firstName: m.firstName, lastName: m.lastName }))}
            assignments={assignments}
            availableInstruments={instruments}
            isReadOnly={isReadOnly}
          />
        )}
      </div>
    </AppShell>
  );
}
