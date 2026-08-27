import type { AppRole } from "@/types/database.types";

/**
 * Canonical role list, ordered from highest to lowest privilege.
 * Mirrors umsuka.profiles.role (free-text column, values enforced here
 * and, for privileged mutations, validated server-side / in RLS).
 */
export const APP_ROLES: readonly AppRole[] = [
  "super_admin",
  "admin",
  "board_member",
  "event_manager",
  "member",
  "guest",
] as const;

export const DEFAULT_ROLE: AppRole = "member";

/** Roles considered "administrative" for baseline RLS and route guards. */
export const ADMIN_ROLES: readonly AppRole[] = ["super_admin", "admin"] as const;

/** Roles allowed to manage operational content (events, shifts, etc.). */
export const MANAGEMENT_ROLES: readonly AppRole[] = [
  "super_admin",
  "admin",
  "board_member",
  "event_manager",
] as const;

export function isValidRole(value: string): value is AppRole {
  return (APP_ROLES as readonly string[]).includes(value);
}

export function isAdminRole(role: AppRole): boolean {
  return (ADMIN_ROLES as readonly AppRole[]).includes(role);
}

export function isManagementRole(role: AppRole): boolean {
  return (MANAGEMENT_ROLES as readonly AppRole[]).includes(role);
}

/**
 * Role rank used for hierarchical comparisons (lower index = higher
 * privilege). Returns Infinity for unknown roles so they are always
 * treated as least privileged.
 */
export function roleRank(role: AppRole): number {
  const index = APP_ROLES.indexOf(role);
  return index === -1 ? Number.POSITIVE_INFINITY : index;
}

export function hasAtLeastRole(role: AppRole, minimumRole: AppRole): boolean {
  return roleRank(role) <= roleRank(minimumRole);
}

/** Human-readable labels for roles (es-ES). */
export const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "Super Admin",
  admin: "Administrador",
  board_member: "Directiva",
  event_manager: "Gestor de Eventos",
  member: "Miembro",
  guest: "Invitado",
};

export function getRoleLabel(role: AppRole): string {
  return ROLE_LABELS[role] ?? role;
}

/** Human-readable labels for component types (es-ES). */
export const COMPONENT_TYPE_LABELS: Record<string, string> = {
  music: "Música",
  dance: "Baile",
  member: "Miembro",
};

export function getComponentTypeLabel(componentType: string): string {
  return COMPONENT_TYPE_LABELS[componentType] ?? componentType;
}

/** Human-readable labels for workgroups (es-ES). */
export const WORKGROUP_LABELS: Record<string, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
  ninguno: "Sin grupo",
};

export function getWorkgroupLabel(workgroup: string): string {
  return WORKGROUP_LABELS[workgroup] ?? workgroup;
}
