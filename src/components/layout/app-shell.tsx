import type { ReactNode } from "react";
import { Sidebar } from "@/components/layout/sidebar";
import { BottomNav } from "@/components/layout/bottom-nav";
import type { AuthenticatedProfile } from "@/types/auth";

interface AppShellProps {
  profile: AuthenticatedProfile;
  children: ReactNode;
}

export function AppShell({ profile, children }: AppShellProps) {
  const userName = `${profile.firstName} ${profile.lastName}`;

  return (
    <div className="min-h-screen bg-background">
      <Sidebar
        currentRole={profile.role}
        isWorkgroupLead={profile.isWorkgroupLead}
        workgroup={profile.workgroup}
        userName={userName}
        userEmail={profile.email}
      />
      <BottomNav
        currentRole={profile.role}
        isWorkgroupLead={profile.isWorkgroupLead}
        workgroup={profile.workgroup}
      />
      <main className="md:pl-sidebar pb-16 md:pb-0">
        <div className="feed-container px-4 py-4 sm:px-6 sm:py-6">
          {children}
        </div>
      </main>
    </div>
  );
}
