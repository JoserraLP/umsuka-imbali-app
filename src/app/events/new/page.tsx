import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
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

  if (!isManagementRole(profile.role)) {
    redirect("/events");
  }

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Nuevo evento</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Crea una actividad, reunión o fecha de carnaval.
          </p>
          <Link href="/events" className="mt-2 inline-block text-sm text-muted-foreground hover:text-foreground">
            ← Volver a eventos
          </Link>
        </div>

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
      </div>
    </AppShell>
  );
}
