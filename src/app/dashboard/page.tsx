import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { getInstagramPosts } from "@/lib/social/instagram";
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

  // Fetch Instagram posts and upcoming events in parallel
  const [posts, events] = await Promise.all([
    getInstagramPosts(9),
    listEvents({ from: new Date().toISOString() }),
  ]);

  return (
    <AppShell profile={profile}>
      <DashboardContent
        profile={profile}
        posts={posts}
        events={events}
        signOutAction={signOutAction}
      />
    </AppShell>
  );
}
