"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { getVisibleLinks, isLinkActive } from "@/components/layout/nav-links";
import type { AppRole, Workgroup } from "@/types/database.types";

interface BottomNavProps {
  currentRole: AppRole;
  isWorkgroupLead: boolean;
  workgroup: Workgroup;
}

export function BottomNav({ currentRole, isWorkgroupLead, workgroup }: BottomNavProps) {
  const pathname = usePathname();
  const links = getVisibleLinks({ role: currentRole, isWorkgroupLead, workgroup });

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-30 border-t bg-background md:hidden">
      <div className="flex items-center justify-around px-2 py-1">
        {links.map((link) => {
          const isActive = isLinkActive(link.href, pathname, links);
          const Icon = link.icon;

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-2 text-[11px] transition-colors ${
                isActive
                  ? "text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="h-5 w-5" />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
