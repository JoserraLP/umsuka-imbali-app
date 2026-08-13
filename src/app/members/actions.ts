"use server";

import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/permissions";
import {
  resolveMemberScope,
  canViewMemberDetail,
} from "@/lib/members/authorization";
import {
  getAllMembers,
  getWorkgroupMembers,
  getComponentMembers,
  getMemberDetail,
  getMemberDetailWithHistory,
  type MemberHistory,
} from "@/lib/members/queries";
import type { MemberListItem } from "@/lib/members/schema";

export type MembersActionResult =
  | { success: true; data: MemberListItem[] }
  | { success: false; error: string };

export type MemberDetailActionResult =
  | { success: true; data: MemberHistory | null }
  | { success: false; error: string };

/**
 * Returns the member directory scoped to the caller: management roles get
 * every member; workgroup leads get only the members of their own group;
 * component leads only the members of their own component (music/dance);
 * anyone else gets an error. The scope is always derived from the
 * authenticated profile, never from client input.
 */
export async function getMembersAction(): Promise<MembersActionResult> {
  try {
    const actor = await requireAuthenticatedProfile();
    const scope = resolveMemberScope(actor);

    const members =
      scope.kind === "all"
        ? await getAllMembers()
        : scope.kind === "workgroup"
          ? await getWorkgroupMembers(actor, scope.workgroup)
          : await getComponentMembers(actor, scope.component);

    return { success: true, data: members };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { success: false, error: error.message };
    }
    console.error("getMembersAction failed", error);
    return { success: false, error: "Error inesperado al cargar los miembros." };
  }
}

/**
 * Returns the detail (profile + assigned shifts + attendance) for a single
 * member. Validated with canViewMemberDetail so a lead can only ever
 * receive data of members in their own workgroup/component; management
 * sees anyone. Returns `{ success: true, data: null }` when the member
 * does not exist.
 */
export async function getMemberDetailAction(
  userId: string,
): Promise<MemberDetailActionResult> {
  try {
    const actor = await requireAuthenticatedProfile();

    const member = await getMemberDetail(userId);

    if (!member) {
      return { success: true, data: null };
    }

    if (!canViewMemberDetail(actor, { workgroup: member.workgroup, componentType: member.componentType })) {
      return {
        success: false,
        error: "No tienes permisos para ver la ficha de este miembro.",
      };
    }

    const history = await getMemberDetailWithHistory(userId);
    return { success: true, data: history };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { success: false, error: error.message };
    }
    console.error("getMemberDetailAction failed", error);
    return { success: false, error: "Error inesperado al cargar el miembro." };
  }
}
