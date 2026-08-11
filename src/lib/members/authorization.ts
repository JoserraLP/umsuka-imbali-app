import { isManagementRole } from "@/lib/auth/roles";
import { AuthorizationError } from "@/lib/auth/permissions";
import type { AppRole, Workgroup } from "@/types/database.types";

/**
 * Minimal actor context required to evaluate member-directory access.
 * Mirrors the shape of AuthenticatedProfile (src/types/auth.ts) but only
 * carries the fields these rules depend on, so the helpers stay pure and
 * trivially unit-testable without touching the database.
 */
export interface MemberActor {
  role: AppRole;
  isWorkgroupLead: boolean;
  workgroup: Workgroup;
}

/**
 * The visibility scope a caller is entitled to see:
 * - "all" — the whole directory (management roles).
 * - "workgroup" — only the members of the caller's own workgroup (leads).
 * The workgroup is ALWAYS derived from the actor, never from caller input.
 */
export type MemberScope = { kind: "all" } | { kind: "workgroup"; workgroup: Workgroup };

/**
 * True when the actor can open the member directory at all: management
 * roles see everything; workgroup leads see only their own group. A lead
 * without a real workgroup ("ninguno") is treated as a non-lead.
 */
export function canViewMembers(actor: MemberActor | null | undefined): boolean {
  if (!actor) return false;
  return isManagementRole(actor.role) || (actor.isWorkgroupLead && actor.workgroup !== "ninguno");
}

/**
 * Resolves the scope for the member-directory queries. Throws
 * AuthorizationError for anyone not entitled (plain members, guests,
 * leads without a group). Callers must catch it and surface an error.
 */
export function resolveMemberScope(actor: MemberActor | null | undefined): MemberScope {
  if (!actor) {
    throw new AuthorizationError();
  }
  if (isManagementRole(actor.role)) {
    return { kind: "all" };
  }
  if (actor.isWorkgroupLead && actor.workgroup !== "ninguno") {
    return { kind: "workgroup", workgroup: actor.workgroup };
  }
  throw new AuthorizationError();
}

/**
 * True when the actor may view the detail (profile, shifts, attendance)
 * of a member who belongs to `targetWorkgroup`: management always; a
 * lead only for members of their own workgroup.
 */
export function canViewMemberDetail(
  actor: MemberActor | null | undefined,
  targetWorkgroup: Workgroup,
): boolean {
  if (!actor) return false;
  if (isManagementRole(actor.role)) return true;
  if (!actor.isWorkgroupLead || actor.workgroup === "ninguno") return false;
  return targetWorkgroup === actor.workgroup;
}

/**
 * True when the actor is the lead of the given workgroup. Used by
 * getWorkgroupMembers as defense in depth — the requested workgroup is
 * never trusted on its own, it must match the actor's own group.
 */
export function isLeadOfGroup(actor: MemberActor | null | undefined, workgroup: Workgroup): boolean {
  if (!actor) return false;
  return actor.isWorkgroupLead && actor.workgroup !== "ninguno" && actor.workgroup === workgroup;
}
