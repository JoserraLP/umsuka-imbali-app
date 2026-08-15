import { ADMIN_ROLES, MANAGEMENT_ROLES } from "@/lib/auth/roles";
import type { AppRole } from "@/types/database.types";

/**
 * Foundation-level authorization guard. Business modules will extend this
 * with resource-specific rules (e.g. "can edit this specific event"); this
 * file intentionally only defines the generic, module-agnostic checks so
 * it stays valid regardless of which modules are implemented later.
 */
export class AuthorizationError extends Error {
  constructor(message = "No tienes permisos para realizar esta acción.") {
    super(message);
    this.name = "AuthorizationError";
  }
}

export function requireRole(role: AppRole | null | undefined, allowed: readonly AppRole[]): void {
  if (!role || !allowed.includes(role)) {
    throw new AuthorizationError();
  }
}

export function requireAdmin(role: AppRole | null | undefined): void {
  requireRole(role, ADMIN_ROLES);
}

export function requireSuperAdmin(role: AppRole | null | undefined): void {
  requireRole(role, ["super_admin"]);
}

export function requireManagement(role: AppRole | null | undefined): void {
  requireRole(role, MANAGEMENT_ROLES);
}

export function can(role: AppRole | null | undefined, allowed: readonly AppRole[]): boolean {
  return !!role && allowed.includes(role);
}

/**
 * Principle of least privilege for role assignment: only a super_admin may
 * grant or revoke the super_admin / admin roles. A plain admin may assign
 * any of the remaining operational roles. Everyone below admin cannot
 * assign roles at all (callers must gate on requireAdmin() first).
 */
const PRIVILEGED_ROLES: readonly AppRole[] = ["super_admin", "admin"];

export function canAssignRole(actorRole: AppRole | null | undefined, targetRole: AppRole): boolean {
  if (!actorRole || !can(actorRole, ADMIN_ROLES)) {
    return false;
  }

  if (PRIVILEGED_ROLES.includes(targetRole)) {
    return actorRole === "super_admin";
  }

  return true;
}
