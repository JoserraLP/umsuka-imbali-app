import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { getInstagramProfile } from "@/lib/social/instagram";
import type { InstagramProfile } from "@/lib/social/instagram";
import { listEvents } from "@/lib/events/queries";
import { DashboardContent } from "@/app/dashboard/dashboard-content";
import { signOutAction } from "@/app/dashboard/actions";

export const metadata: Metadata = {
  title: "Panel de control",
};

export default async function DashboardPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  // Fetch Instagram profile and upcoming events in parallel
  const [igProfile, events] = await Promise.all([
    getInstagramProfile(),
    listEvents({ from: new Date().toISOString() }),
  ]);

  return (
    <AppShell profile={profile}>
      <DashboardContent
        profile={profile}
        instagramProfile={igProfile}
        events={events}
        signOutAction={signOutAction}
      />
    </AppShell>
  );
}
