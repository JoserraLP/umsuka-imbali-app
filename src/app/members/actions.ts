"use server";

import { requireAuthenticatedProfile } from "@/lib/auth/session";
import {
  resolveMemberScope,
  canViewMemberDetail,
} from "@/lib/members/authorization";
import {
  getAllMembers,
  getWorkgroupMembers,
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
        : await getWorkgroupMembers(actor, scope.workgroup);

    return { success: true, data: members };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error inesperado al cargar los miembros.",
    };
  }
}

/**
 * Returns the detail (profile + assigned shifts + attendance) for a single
 * member. Validated with canViewMemberDetail so a lead can only ever
 * receive data of members in their own workgroup; management sees anyone.
 * Returns `{ success: true, data: null }` when the member does not exist.
 */
export async function getMemberDetailAction(
  userId: string,
): Promise<MemberDetailActionResult> {
  try {
    const actor = await requireAuthenticatedProfile();

    const history = await getMemberDetailWithHistory(userId);

    if (!history) {
      return { success: true, data: null };
    }

    if (!canViewMemberDetail(actor, history.member.workgroup)) {
      return {
        success: false,
        error: "No tienes permisos para ver la ficha de este miembro.",
      };
    }

    return { success: true, data: history };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error inesperado al cargar el miembro.",
    };
  }
}
