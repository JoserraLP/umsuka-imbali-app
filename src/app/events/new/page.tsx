import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getAudienceOptions } from "@/lib/events/audience";
import { EventForm } from "@/app/events/event-form";
import type { EventWorkgroup } from "@/lib/events/schema";

export const metadata: Metadata = {
  title: "Nuevo evento",
};

export default async function NewEventPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  if (!isManagementRole(profile.role) && !profile.isWorkgroupLead) {
    redirect("/events");
  }

  // Non-management leads can only create work_shift events for their own group.
  const isManagement = isManagementRole(profile.role);
  const audienceMembers = isManagement ? await getAudienceOptions() : [];

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-4">
        <div className="border-b border-border pb-4">
          <h1 className="text-xl font-bold tracking-tight">Nuevo evento</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {isManagement
              ? "Crea una actividad, reunión o fecha de carnaval."
              : "Crea un turno de trabajo para tu grupo."}
          </p>
          <Link
            href="/events"
            className="mt-2 inline-block text-sm text-muted-foreground hover:text-foreground"
          >
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
                  eventType: isManagement ? "general" : "work_shift",
                  eventDate: "",
                  capacity: null,
                  location: "",
                  imageUrl: "",
                  registrationDeadline: "",
                  morningSession: false,
                  afternoonSession: false,
                  workgroup: (isManagement ? null : profile.workgroup) as EventWorkgroup | null,
                  audienceType: "all",
                  audienceWorkgroup: null,
                  audienceMemberType: null,
                  audienceUserIds: [],
                }}
              leadWorkgroup={isManagement ? undefined : profile.workgroup}
              audienceMembers={audienceMembers}
              canConfigureAudience={isManagement}
            />
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}
