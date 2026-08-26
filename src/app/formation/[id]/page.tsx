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

  const [dancers, musicians, instruments, assignments] = await Promise.all([
    getAvailableDancers(),
    getAvailableMusicians(),
    getAvailableInstruments(formation.id),
    getMusicianInstruments(formation.id),
  ]);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <Link href="/formation" className="text-sm text-muted-foreground hover:text-foreground">
            ← Volver a formaciones
          </Link>
          <h1 className="mt-2 text-xl font-bold tracking-tight">{formation.name}</h1>
          <p className="text-sm text-muted-foreground">
            {formation.eventId ? `Ligada a evento ${formation.eventId.slice(0, 8)}…` : "Formación base (sin evento)"} ·{" "}
            {new Date(formation.createdAt).toLocaleDateString("es-ES")}
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Bailarinas</CardTitle>
            <CardDescription>Filas de 6 asientos (3 + pasillo central + 3). {isReadOnly ? "Solo lectura." : "Arrastra o haz clic para asignar/mover."}</CardDescription>
          </CardHeader>
          <CardContent>
            <DanceFormationGrid formation={formation} availableDancers={dancers} isReadOnly={isReadOnly} />
          </CardContent>
        </Card>

        <MusicianInstrumentList
          formationId={formation.id}
          musicians={musicians.map((m) => ({ id: m.id, firstName: m.firstName, lastName: m.lastName }))}
          assignments={assignments}
          availableInstruments={instruments}
          isReadOnly={isReadOnly}
        />
      </div>
    </AppShell>
  );
}
