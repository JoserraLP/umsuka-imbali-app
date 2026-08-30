import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getInstagramProfile } from "@/lib/social/instagram";
import { listEvents } from "@/lib/events/queries";
import { getNewsFeed } from "@/lib/news/queries";
import { getMemberSummary } from "@/lib/summary/queries";
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

  // Fetch Instagram profile, upcoming events, latest news and member summary in parallel
  const [igProfile, events, allNews, memberSummary] = await Promise.all([
    getInstagramProfile(),
    listEvents(
      { from: new Date().toISOString() },
      {
        workgroup: profile.workgroup,
        componentType: profile.componentType,
        isManagement: isManagementRole(profile.role),
      },
    ),
    getNewsFeed(false), // only published news for the dashboard
    getMemberSummary(profile.id).catch(() => null),
  ]);

  const latestNews = allNews.slice(0, 2);

  return (
    <AppShell profile={profile}>
      <DashboardContent
        profile={profile}
        instagramProfile={igProfile}
        events={events}
        latestNews={latestNews}
        memberSummary={memberSummary}
        signOutAction={signOutAction}
      />
    </AppShell>
  );
}
