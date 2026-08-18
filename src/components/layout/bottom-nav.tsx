"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NavNotificationBadge } from "@/components/layout/nav-notification-badge";
import { getVisibleLinks, isLinkActive } from "@/components/layout/nav-links";
import type { AppRole, ComponentType, Workgroup } from "@/types/database.types";

interface BottomNavProps {
  currentRole: AppRole;
  isWorkgroupLead: boolean;
  workgroup: Workgroup;
  componentLeadFor: ComponentType | null;
  userId: string;
}

export function BottomNav({
  currentRole,
  isWorkgroupLead,
  workgroup,
  componentLeadFor,
  userId,
}: BottomNavProps) {
  const pathname = usePathname();
  const links = getVisibleLinks({ role: currentRole, isWorkgroupLead, workgroup, componentLeadFor });

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background md:hidden">
      <div className="flex items-center justify-around px-2 py-1">
        {links.map((link) => {
          const isActive = isLinkActive(link.href, pathname, links);
          const Icon = link.icon;
          const icon = (
            <Icon
              className={`h-5 w-5 ${isActive ? "text-primary" : "text-muted-foreground"}`}
            />
          );

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`relative flex flex-col items-center gap-0.5 px-3 py-2 text-[11px] transition-colors ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {link.href === "/notifications" ? (
                <NavNotificationBadge userId={userId}>{icon}</NavNotificationBadge>
              ) : (
                icon
              )}
              <span>{link.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
