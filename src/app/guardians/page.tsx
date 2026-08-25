import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getGuardians, getMinorsWithGuardians, getAvailableMembersForGuardian } from "@/lib/guardians/queries";
import { Shield } from "lucide-react";
import { GuardianForm } from "@/app/guardians/guardian-form";
import { MinorGuardianList } from "@/app/guardians/minor-guardian-list";
import {
  AssignGuardianForm,
  UnassignGuardianForm,
  SetMinorStatusForm,
} from "@/app/guardians/assign-guardian-form";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const metadata: Metadata = {
  title: "Representantes",
};

export default async function GuardiansPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  if (!isManagementRole(profile.role)) {
    redirect("/dashboard");
  }

  const [guardians, minorsWithGuardians, availableMembers] = await Promise.all([
    getGuardians(),
    getMinorsWithGuardians(),
    getAvailableMembersForGuardian(),
  ]);

  // All profiles for minor status toggle (reuse minors + available)
  // We need all members list: combine minors and available, plus guardians' members.
  // For simplicity, fetch minorsWithGuardians profiles plus availableMembers.
  const allMembersForToggle = [
    ...minorsWithGuardians.map((m) => ({
      id: m.profile.id,
      firstName: m.profile.firstName,
      lastName: m.profile.lastName,
      isMinor: m.profile.isMinor,
    })),
    ...availableMembers.map((m) => ({
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      isMinor: m.isMinor,
    })),
  ];

  // Deduplicate by id
  const deduped = new Map(allMembersForToggle.map((m) => [m.id, m]));
  const membersList = [...deduped.values()];

  const minors = minorsWithGuardians.map((m) => m.profile);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <Shield className="h-5 w-5" />
              Representantes legales
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Gestión de representantes legales para menores de edad. Solo visible para la directiva.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Crear representante</CardTitle>
            <CardDescription>Da de alta un representante interno (miembro) o externo.</CardDescription>
          </CardHeader>
          <CardContent>
            <GuardianForm mode="create" availableMembers={availableMembers} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Menores y sus representantes ({minorsWithGuardians.length})</CardTitle>
            <CardDescription>Listado de menores registrados y su representante asignado.</CardDescription>
          </CardHeader>
          <CardContent>
            <MinorGuardianList items={minorsWithGuardians} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Asignar representante</CardTitle>
            <CardDescription>Asigna un representante a un menor marcado como tal.</CardDescription>
          </CardHeader>
          <CardContent>
            <AssignGuardianForm
              minors={minors.map((m) => ({
                id: m.id,
                firstName: m.firstName,
                lastName: m.lastName,
                legalGuardianId: m.legalGuardianId,
              }))}
              guardians={guardians.map((g) => ({ id: g.id, fullName: g.fullName }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Quitar representante</CardTitle>
          </CardHeader>
          <CardContent>
            <UnassignGuardianForm
              minors={minors.map((m) => ({
                id: m.id,
                firstName: m.firstName,
                lastName: m.lastName,
                legalGuardianId: m.legalGuardianId,
              }))}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Marcar menor de edad</CardTitle>
            <CardDescription>Marca o desmarca un perfil como menor de edad.</CardDescription>
          </CardHeader>
          <CardContent>
            <SetMinorStatusForm members={membersList} />
          </CardContent>
        </Card>

        {guardians.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle>Representantes dados de alta ({guardians.length})</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {guardians.map((g) => (
                <div key={g.id} className="rounded border p-3 text-sm">
                  <p className="font-medium">{g.fullName}</p>
                  <p className="text-muted-foreground">
                    {g.isMember ? `Miembro: ${g.memberUserId?.slice(0, 8)}…` : `${g.relationship ?? "—"}`}
                    {g.email ? ` · ${g.email}` : ""}
                    {g.phone ? ` · ${g.phone}` : ""}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </AppShell>
  );
}
