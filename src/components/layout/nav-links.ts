import {
  Home,
  Calendar,
  CalendarDays,
  User,
  Clock,
  Users,
  UserCheck,
  Newspaper,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";
import type { AppRole, Workgroup } from "@/types/database.types";
import { isManagementRole, isAdminRole } from "@/lib/auth/roles";

/**
 * Context evaluated by NavLink.showFor. Mirrors the authorization-relevant
 * fields of AuthenticatedProfile so link visibility stays in sync with the
 * route guards (see src/lib/members/authorization.ts).
 */
export interface NavLinkContext {
  role: AppRole;
  isWorkgroupLead: boolean;
  workgroup: Workgroup;
}

export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  showFor?: (ctx: NavLinkContext) => boolean;
}

export const NAV_LINKS: NavLink[] = [
  { href: "/dashboard", label: "Inicio", icon: Home },
  { href: "/events", label: "Eventos", icon: Calendar },
  { href: "/calendar", label: "Calendario", icon: CalendarDays },
  { href: "/news", label: "Noticias", icon: Newspaper },
  { href: "/questions", label: "Preguntas", icon: MessageSquare },
  { href: "/profile", label: "Mi perfil", icon: User },
  { href: "/profile/history", label: "Historial", icon: Clock },
  {
    href: "/members",
    label: "Directorio",
    icon: Users,
    showFor: (ctx) => isManagementRole(ctx.role) || (ctx.isWorkgroupLead && ctx.workgroup !== "ninguno"),
  },
  {
    href: "/admin/users",
    label: "Miembros",
    icon: Users,
    showFor: (ctx) => isManagementRole(ctx.role),
  },
  {
    href: "/admin/registrations",
    label: "Aprobaciones",
    icon: UserCheck,
    showFor: (ctx) => isAdminRole(ctx.role),
  },
];

export function getVisibleLinks(ctx: NavLinkContext): NavLink[] {
  return NAV_LINKS.filter((link) => !link.showFor || link.showFor(ctx));
}

export function isLinkActive(href: string, pathname: string, allLinks: NavLink[]): boolean {
  if (pathname === href) return true;

  const hrefWithSlash = href + "/";
  if (pathname.startsWith(hrefWithSlash)) {
    const hasMoreSpecificMatch = allLinks.some(
      (other) =>
        other.href !== href &&
        other.href.startsWith(hrefWithSlash) &&
        (pathname === other.href || pathname.startsWith(other.href + "/")),
    );
    return !hasMoreSpecificMatch;
  }

  return false;
}
