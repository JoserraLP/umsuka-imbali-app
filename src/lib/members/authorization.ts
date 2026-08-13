import { isManagementRole } from "@/lib/auth/roles";
import { AuthorizationError } from "@/lib/auth/permissions";
import type { AppRole, ComponentType, Workgroup } from "@/types/database.types";

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
  /** "music" / "dance" when the actor is the responsable de ese componente. */
  componentLeadFor: ComponentType | null;
}

/**
 * The visibility scope a caller is entitled to see:
 * - "all" — the whole directory (management roles).
 * - "workgroup" — only the members of the caller's own workgroup (leads).
 * - "component" — only the members of the caller's own component
 *   (music/dance leads).
 * The workgroup/component are ALWAYS derived from the actor, never from
 * caller input. Precedence: management > component > workgroup.
 */
export type MemberScope =
  | { kind: "all" }
  | { kind: "workgroup"; workgroup: Workgroup }
  | { kind: "component"; component: ComponentType };

/**
 * True when the actor can open the member directory at all: management
 * roles see everything; workgroup leads see only their own group; a
 * component lead sees only their own component. A lead without a real
 * workgroup ("ninguno") or a member with componentLeadFor null is treated
 * as a non-lead.
 */
export function canViewMembers(actor: MemberActor | null | undefined): boolean {
  if (!actor) return false;
  return (
    isManagementRole(actor.role) ||
    (actor.isWorkgroupLead && actor.workgroup !== "ninguno") ||
    actor.componentLeadFor !== null
  );
}

/**
 * Resolves the scope for the member-directory queries. Throws
 * AuthorizationError for anyone not entitled (plain members, guests,
 * leads without a group). Precedence: management → all; component lead →
 * their component; workgroup lead → their workgroup. Callers must catch
 * it and surface an error.
 */
export function resolveMemberScope(actor: MemberActor | null | undefined): MemberScope {
  if (!actor) {
    throw new AuthorizationError();
  }
  if (isManagementRole(actor.role)) {
    return { kind: "all" };
  }
  if (actor.componentLeadFor !== null) {
    return { kind: "component", component: actor.componentLeadFor };
  }
  if (actor.isWorkgroupLead && actor.workgroup !== "ninguno") {
    return { kind: "workgroup", workgroup: actor.workgroup };
  }
  throw new AuthorizationError();
}

/**
 * True when the actor may view the detail (profile, shifts, attendance)
 * of a member described by `target` (their workgroup + component type):
 * management always; a component lead only for members of their own
 * component (any workgroup); a workgroup lead only for members of their
 * own workgroup. Component scope takes precedence when the actor holds
 * both designations.
 */
export function canViewMemberDetail(
  actor: MemberActor | null | undefined,
  target: { workgroup: Workgroup; componentType: ComponentType },
): boolean {
  if (!actor) return false;
  if (isManagementRole(actor.role)) return true;
  if (actor.componentLeadFor !== null) {
    return target.componentType === actor.componentLeadFor;
  }
  if (!actor.isWorkgroupLead || actor.workgroup === "ninguno") return false;
  return target.workgroup === actor.workgroup;
}

/**
 * The filter locks the /members page must apply to the actor's OWN view:
 * exactly ONE lock can be set at most (the winning scope's dimension),
 * so the other dimension stays free to filter within the scope. Mirrors
 * the resolveMemberScope precedence (management > component > workgroup)
 * without throwing — denied actors simply get no locks.
 */
export interface MemberLocks {
  lockedWorkgroup: Workgroup | null;
  lockedComponent: ComponentType | null;
}

/**
 * Derives the filter locks for the /members page from the actor's scope:
 * - management ("all") → no locks (both filters free).
 * - component lead → the component select is locked; workgroup stays free.
 * - workgroup lead → the workgroup select is locked; component stays free.
 * - denied actors (members/guests, leads without a real group) → no locks.
 * A dual workgroup+component lead is governed by the component scope, so
 * their workgroup filter remains free (component wins).
 */
export function resolveMemberLocks(actor: MemberActor | null | undefined): MemberLocks {
  if (!actor) {
    return { lockedWorkgroup: null, lockedComponent: null };
  }
  if (isManagementRole(actor.role)) {
    return { lockedWorkgroup: null, lockedComponent: null };
  }
  if (actor.componentLeadFor !== null) {
    return { lockedWorkgroup: null, lockedComponent: actor.componentLeadFor };
  }
  if (actor.isWorkgroupLead && actor.workgroup !== "ninguno") {
    return { lockedWorkgroup: actor.workgroup, lockedComponent: null };
  }
  return { lockedWorkgroup: null, lockedComponent: null };
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

/**
 * True when the actor is the lead (responsable) of the given component
 * (music/dance). Used by getComponentMembers as defense in depth — the
 * requested component is never trusted on its own, it must match the
 * actor's own componentLeadFor.
 */
export function isLeadOfComponent(
  actor: MemberActor | null | undefined,
  component: ComponentType,
): boolean {
  if (!actor) return false;
  return actor.componentLeadFor === component;
}
