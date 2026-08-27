import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getFormations } from "@/lib/formation/queries";
import { FormationForm } from "@/app/formation/formation-form";
import { DuplicateButton } from "@/app/formation/duplicate-button";

export const metadata: Metadata = { title: "Formaciones" };

export default async function FormationPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth/login");

  const canManage = isManagementRole(profile.role);
  const formations = await getFormations();
  const eventOptions: Array<{ id: string; title: string }> = [];

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-6">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Formaciones</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {canManage ? "Gestiona las formaciones por tipo (baile/música)." : "Consulta las formaciones de tu componente."} {profile.componentType === "dance" ? "Ves solo baile." : profile.componentType === "music" ? "Ves solo música." : ""}
          </p>
          {!canManage && profile.componentType === "member" && (
            <p className="mt-2 text-xs text-amber-600">Tu componente es “member”: no verás formaciones hasta que directiva te asigne a baile o música.</p>
          )}
        </div>

        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Crear formación</CardTitle>
              <CardDescription>Nombre entre 1 y 200 caracteres. Opcionalmente ligada a un evento.</CardDescription>
            </CardHeader>
            <CardContent>
              <FormationForm eventOptions={eventOptions} />
            </CardContent>
          </Card>
        )}

        <div>
          <h2 className="mb-3 text-sm font-semibold">Formaciones ({formations.length})</h2>
          {formations.length === 0 ? (
            <p className="text-sm text-muted-foreground">No hay formaciones aún.</p>
          ) : (
            <div className="grid gap-3">
              {formations.map((f) => (
                <Card key={f.id} className="flex flex-col">
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">
                        <Link href={`/formation/${f.id}`} className="hover:underline">
                          {f.name}
                        </Link>
                      </CardTitle>
                      <div className="flex items-center gap-2">
                        <Badge variant={f.formationType === "dance" ? "default" : "secondary"} className="text-xs">
                          {f.formationType === "dance" ? "Baile" : "Música"}
                        </Badge>
                        {f.eventId && <Badge variant="outline">Evento</Badge>}
                        <Badge variant="secondary">{new Date(f.createdAt).toLocaleDateString("es-ES")}</Badge>
                      </div>
                    </div>
                    <CardDescription className="text-xs">ID: {f.id.slice(0, 8)}…</CardDescription>
                  </CardHeader>
                  <CardContent className="flex items-center gap-2">
                    <Link href={`/formation/${f.id}`} className="text-sm text-primary hover:underline">
                      Ver detalle
                    </Link>
                    {canManage && <DuplicateButton formationId={f.id} />}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
