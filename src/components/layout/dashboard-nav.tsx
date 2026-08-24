import Link from "next/link";
import { isManagementRole } from "@/lib/auth/roles";
import type { AppRole } from "@/types/database.types";

interface DashboardNavProps {
  currentRole: AppRole;
}

export function DashboardNav({ currentRole }: DashboardNavProps) {
  const links: Array<{ href: string; label: string }> = [
    { href: "/dashboard", label: "Inicio" },
    { href: "/events", label: "Eventos" },
    { href: "/calendar", label: "Calendario" },
    { href: "/profile", label: "Mi perfil" },
    { href: "/profile/stats", label: "Mis estadísticas" },
  ];

  if (isManagementRole(currentRole)) {
    links.push({ href: "/admin/users", label: "Administración de miembros" });
  }

  return (
    <nav className="flex gap-4 overflow-x-auto border-b pb-2 text-sm">
      {links.map((link) => (
        <Link
          key={link.href}
          href={link.href}
          className="text-muted-foreground transition-colors hover:text-foreground whitespace-nowrap"
        >
          {link.label}
        </Link>
      ))}
    </nav>
  );
}
