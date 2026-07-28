import {
  Home,
  Calendar,
  CalendarDays,
  User,
  Clock,
  Users,
  type LucideIcon,
} from "lucide-react";
import type { AppRole } from "@/types/database.types";
import { isManagementRole } from "@/lib/auth/roles";

export interface NavLink {
  href: string;
  label: string;
  icon: LucideIcon;
  showFor?: (role: AppRole) => boolean;
}

export const NAV_LINKS: NavLink[] = [
  { href: "/dashboard", label: "Inicio", icon: Home },
  { href: "/events", label: "Eventos", icon: Calendar },
  { href: "/calendar", label: "Calendario", icon: CalendarDays },
  { href: "/profile", label: "Mi perfil", icon: User },
  { href: "/profile/history", label: "Historial", icon: Clock },
  {
    href: "/admin/users",
    label: "Miembros",
    icon: Users,
    showFor: (role) => isManagementRole(role),
  },
];

export function getVisibleLinks(role: AppRole): NavLink[] {
  return NAV_LINKS.filter((link) => !link.showFor || link.showFor(role));
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
