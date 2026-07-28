import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DashboardNav } from "@/components/layout/dashboard-nav";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { EventForm } from "@/app/events/event-form";

export const metadata: Metadata = {
  title: "Nuevo evento",
};

export default async function NewEventPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  // Server-side authorization gate (layer 2 of 3 — RLS on umsuka.events
  // is the authoritative layer regardless of this check).
  if (!isManagementRole(profile.role)) {
    redirect("/events");
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-2xl flex-col gap-6 p-4 sm:p-8">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold tracking-tight sm:text-2xl">Nuevo evento</h1>
          <p className="text-sm text-muted-foreground">
            Crea una actividad, reunión o fecha de carnaval.
          </p>
        </div>
        <ThemeToggle />
      </header>

      <DashboardNav currentRole={profile.role} />

      <Card>
        <CardHeader>
          <CardTitle>Detalles del evento</CardTitle>
          <CardDescription>Visible para todos los miembros en cuanto se cree.</CardDescription>
        </CardHeader>
        <CardContent>
          <EventForm
            mode="create"
            defaultValues={{
              title: "",
              description: "",
              eventType: "general",
              eventDate: "",
              capacity: null,
            }}
          />
        </CardContent>
      </Card>
    </main>
  );
}
