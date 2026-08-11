"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { getVisibleLinks, isLinkActive } from "@/components/layout/nav-links";
import { signOutAction } from "@/app/dashboard/actions";
import type { AppRole, Workgroup } from "@/types/database.types";

interface SidebarProps {
  currentRole: AppRole;
  isWorkgroupLead: boolean;
  workgroup: Workgroup;
  userName: string;
  userEmail: string | null;
}

export function Sidebar({ currentRole, isWorkgroupLead, workgroup, userName, userEmail }: SidebarProps) {
  const pathname = usePathname();
  const links = getVisibleLinks({ role: currentRole, isWorkgroupLead, workgroup });

  return (
    <aside className="fixed left-0 top-0 z-30 hidden h-screen w-sidebar flex-col border-r bg-sidebar md:flex">
      <div className="flex h-14 items-center gap-2.5 border-b px-4">
        <div className="relative flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/logo.png"
            alt="Umsuka Imbali"
            className="h-full w-full object-contain"
            onError={(e) => {
              const target = e.currentTarget;
              target.style.display = "none";
              const next = target.nextElementSibling;
              if (next) {
                (next as HTMLElement).style.display = "flex";
              }
            }}
          />
          <span
            className="absolute inset-0 hidden items-center justify-center text-sm font-bold text-brand-foreground"
          >
            U
          </span>
        </div>
        <span className="text-base font-bold tracking-tight">Umsuka Imbali</span>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-2 py-3">
        {links.map((link) => {
          const isActive = isLinkActive(link.href, pathname, links);
          const Icon = link.icon;

          return (
            <Link
              key={link.href}
              href={link.href}
              className={`sidebar-link group ${
                isActive
                  ? "active text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon
                className={`nav-icon ${
                  isActive ? "text-primary" : "text-muted-foreground group-hover:text-foreground"
                }`}
              />
              <span>{link.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-3">
        <div className="mb-2 flex items-center gap-2 px-3 py-1.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted text-xs font-semibold uppercase text-muted-foreground">
            {userName.charAt(0)}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium leading-tight">{userName}</p>
            {userEmail && (
              <p className="truncate text-xs text-muted-foreground">{userEmail}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 px-2">
          <ThemeToggle />
          <form action={signOutAction}>
            <Button type="submit" variant="ghost" size="sm" className="gap-2 text-muted-foreground">
              <LogOut className="h-4 w-4" />
              <span className="text-sm">Cerrar sesión</span>
            </Button>
          </form>
        </div>
      </div>
    </aside>
  );
}
