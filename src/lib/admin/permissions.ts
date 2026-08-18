import { AuthorizationError } from "@/lib/auth/permissions";
import type { AppRole, Permission } from "@/types/database.types";

/**
 * Isomorphic granular permissions map (Sprint 21). Mirrors the
 * umsuka.role_permissions seed of migration 0053 exactly — the seed in
 * SQL is the DB source of truth, and `tests/unit/lib/admin-permissions
 * .test.ts` keeps this map in sync by comparing both literals.
 *
 * Strategy (documented in ADR sprint 21): the permission matrix lives in
 * code (in-memory, fail-closed) instead of being queried from the DB on
 * every guard, because the role set is fixed and the matrix is tiny; the
 * DB table documents the grants and stays ready for future management
 * without touching the guards. `hasPermission` is used ONLY in page
 * guards / server actions / lib mutations — `nav-links.ts` keeps
 * isAdminRole/isManagementRole for menu visibility (see ADR D8).
 */

/** All five granular permissions (mirrors `chk_role_permissions_permission`). */
export const ALL_PERMISSIONS: readonly Permission[] = [
  "users.read",
  "users.manage",
  "settings.read",
  "settings.write",
  "audit.read",
];

export const PERMISSIONS_BY_ROLE: Record<AppRole, readonly Permission[]> = {
  super_admin: ALL_PERMISSIONS,
  admin: ALL_PERMISSIONS,
  board_member: ["users.read"],
  event_manager: ["users.read"],
  member: [],
  guest: [],
};

/**
 * Returns the permissions of a role. Unknown roles (including free-text
 * values that never reach the DB CHECK) fail closed with [].
 */
export function permissionsForRole(role: string): readonly Permission[] {
  return PERMISSIONS_BY_ROLE[role as AppRole] ?? [];
}

/**
 * True when the role holds the given granular permission. null/undefined
 * roles (no session) always return false.
 */
export function hasPermission(
  role: AppRole | null | undefined,
  permission: Permission,
): boolean {
  return !!role && permissionsForRole(role).includes(permission);
}

/**
 * Throws AuthorizationError when the role lacks the permission. Used at
 * the top of every admin guard, query and mutation.
 */
export function requirePermission(
  role: AppRole | null | undefined,
  permission: Permission,
): void {
  if (!hasPermission(role, permission)) {
    throw new AuthorizationError();
  }
}