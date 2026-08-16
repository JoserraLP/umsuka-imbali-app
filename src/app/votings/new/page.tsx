import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { VotingForm } from "@/app/votings/new/voting-form";

export const metadata: Metadata = {
  title: "Nueva votación",
};

export default async function NewVotingPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  if (!isManagementRole(profile.role)) {
    redirect("/votings");
  }

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">
            Nueva votación
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Crea una votación para que los miembros de Umsuka Imbali
            decidan juntos.
          </p>
        </div>

        <VotingForm
          defaultValues={{
            title: "",
            description: "",
            voting_deadline: null,
            options: ["", ""],
          }}
        />
      </div>
    </AppShell>
  );
}