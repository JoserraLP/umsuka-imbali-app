import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { getMyNotifications, getMyNotificationPreferences } from "@/lib/notifications/queries";
import { NOTIFICATIONS_PAGE_SIZE } from "@/lib/notifications/schema";
import { NotificationsList } from "@/app/notifications/notifications-list";
import { NotificationPreferencesCard } from "@/app/notifications/notification-preferences-card";

export const metadata: Metadata = {
  title: "Notificaciones",
};

export default async function NotificationsPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  const [notifications, preferences] = await Promise.all([
    getMyNotifications(profile.id, { limit: NOTIFICATIONS_PAGE_SIZE }),
    getMyNotificationPreferences(profile.id),
  ]);

  return (
    <AppShell profile={profile}>
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <NotificationsList userId={profile.id} initialNotifications={notifications} />
        <NotificationPreferencesCard initialTypes={preferences.types} />
      </div>
    </AppShell>
  );
}
