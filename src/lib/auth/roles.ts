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
