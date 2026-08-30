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
  BarChart3,
  Vote,
  Music,
  Bell,
  Settings,
  ScrollText,
  Wallet,
  Shield,
  CreditCard,
  ClipboardList,
  FileText,
  PartyPopper,
  type LucideIcon,
} from "lucide-react";
import type { AppRole, ComponentType, Workgroup } from "@/types/database.types";
import { isManagementRole, isAdminRole } from "@/lib/auth/roles";
import { hasPermission } from "@/lib/admin/permissions";

/**
 * Context evaluated by NavLink.showFor. Mirrors the authorization-relevant
 * fields of AuthenticatedProfile so link visibility stays in sync with the
 * route guards (see src/lib/members/authorization.ts).
 */
export interface NavLinkContext {
  role: AppRole;
  isWorkgroupLead: boolean;
  workgroup: Workgroup;
  /** "music" / "dance" when the user is the responsable of that component. */
  componentLeadFor: ComponentType | null;
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
  { href: "/votings", label: "Votaciones", icon: Vote },
  { href: "/instruments", label: "Instrumentos", icon: Music },
  {
    href: "/formation",
    label: "Formaciones",
    icon: ClipboardList,
    showFor: (ctx) => isManagementRole(ctx.role) || ctx.componentLeadFor !== null,
  },
  {
    href: "/finances",
    label: "Finanzas",
    icon: Wallet,
    showFor: (ctx) => isManagementRole(ctx.role),
  },
  {
    href: "/guardians",
    label: "Representantes",
    icon: Shield,
    showFor: (ctx) => isManagementRole(ctx.role),
  },
  {
    href: "/payments",
    label: "Pagos",
    icon: CreditCard,
    showFor: (ctx) => isManagementRole(ctx.role),
  },
  { href: "/actas", label: "Actas", icon: FileText },
  {
    href: "/admin/carnival",
    label: "Año Carnaval",
    icon: PartyPopper,
    showFor: (ctx) => isManagementRole(ctx.role),
  },
  { href: "/profile", label: "Mi perfil", icon: User },
  { href: "/profile/stats", label: "Mis estadísticas", icon: Clock },
  { href: "/notifications", label: "Notificaciones", icon: Bell },
  {
    href: "/members",
    label: "Miembros",
    icon: Users,
    showFor: (ctx) =>
      isManagementRole(ctx.role) ||
      (ctx.isWorkgroupLead && ctx.workgroup !== "ninguno") ||
      ctx.componentLeadFor !== null,
  },
  {
    href: "/workgroups",
    label: "Estadísticas",
    icon: BarChart3,
    showFor: (ctx) =>
      ctx.role === "super_admin" || (ctx.isWorkgroupLead && ctx.workgroup !== "ninguno"),
  },
  {
    href: "/admin/users",
    label: "Administración de miembros",
    icon: Users,
    showFor: (ctx) => isManagementRole(ctx.role),
  },
  {
    href: "/admin/registrations",
    label: "Aprobaciones",
    icon: UserCheck,
    showFor: (ctx) => isAdminRole(ctx.role),
  },
  {
    href: "/admin/settings",
    label: "Configuración",
    icon: Settings,
    showFor: (ctx) => hasPermission(ctx.role, "settings.read"),
  },
  {
    href: "/admin/audit",
    label: "Auditoría",
    icon: ScrollText,
    showFor: (ctx) => hasPermission(ctx.role, "audit.read"),
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
