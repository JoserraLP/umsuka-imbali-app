import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { getMinorsByGuardian } from "@/lib/guardians/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Shield } from "lucide-react";

export const metadata: Metadata = {
  title: "Mis menores",
};

export default async function MisMenoresPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const minors = await getMinorsByGuardian(profile.id);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-6">
        <div className="flex items-center gap-2 border-b border-border pb-4">
          <Shield className="h-5 w-5" />
          <div>
            <h1 className="text-xl font-bold tracking-tight">Mis menores a cargo</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Menores que representas como representante legal.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Menores ({minors.length})</CardTitle>
            <CardDescription>
              {minors.length === 0
                ? "No tienes menores asignados."
                : "Listado de menores bajo tu representación."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {minors.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay menores a cargo.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {minors.map((minor) => (
                  <Link
                    key={minor.id}
                    href={`/members/${minor.id}`}
                    className="rounded-lg border p-3 transition-colors hover:bg-muted"
                  >
                    <p className="font-medium">
                      {minor.firstName} {minor.lastName}
                    </p>
                    <p className="text-xs text-muted-foreground">Ver ficha →</p>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
