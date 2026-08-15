import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getCurrentProfile } from "@/lib/auth/session";
import { WorkgroupSelectionForm } from "@/app/onboarding/workgroup/workgroup-selection-form";
import { Users } from "lucide-react";

export const metadata: Metadata = {
  title: "Elige tu grupo de trabajo",
};

/**
 * First-login onboarding: the member picks their workgroup before being
 * let into the app. The middleware redirects any authenticated user with
 * workgroup 'ninguno'/null to this page, so it is deliberately a
 * standalone layout (no AppShell) — the member has no access yet.
 */
export default async function OnboardingWorkgroupPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  // Already has a real workgroup — nothing to onboard.
  if (profile.workgroup !== "ninguno") {
    redirect("/dashboard");
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="mx-auto w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mb-4 flex justify-center">
            <Users className="h-12 w-12 text-muted-foreground" />
          </div>
          <CardTitle className="text-xl">Elige tu grupo de trabajo</CardTitle>
          <CardDescription>
            Para empezar a usar la aplicación, dinos a qué grupo perteneces. Tu grupo determina los
            turnos de trabajo y las tareas que verás.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <WorkgroupSelectionForm />
        </CardContent>
      </Card>
    </div>
  );
}
