"use server";

import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/permissions";
import { activeWorkgroupSchema } from "@/lib/workgroups/schema";
import { getGroupStats, getMemberStatsDetail } from "@/lib/workgroups/stats-queries";
import type { GroupStats, MemberStatsDetail } from "@/lib/workgroups/stats";

export type GroupStatsActionResult =
  | { success: true; data: GroupStats }
  | { success: false; error: string };

export type MemberStatsDetailActionResult =
  | { success: true; data: MemberStatsDetail | null }
  | { success: false; error: string };

/**
 * Aggregated stats of a workgroup. The workgroup is validated against the
 * active enum ("ninguno" never reaches the queries) and the actor's access
 * is enforced inside getGroupStats via canViewGroupStats.
 */
export async function getGroupStatsAction(group: string): Promise<GroupStatsActionResult> {
  const parsed = activeWorkgroupSchema.safeParse(group);
  if (!parsed.success) {
    return { success: false, error: "Grupo no válido." };
  }

  try {
    const actor = await requireAuthenticatedProfile();
    const stats = await getGroupStats(actor, parsed.data);
    return { success: true, data: stats };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { success: false, error: error.message };
    }
    console.error("getGroupStatsAction failed", error);
    return { success: false, error: "Error inesperado al cargar las estadísticas." };
  }
}

/**
 * Detailed stats of a single member within a workgroup (summary +
 * per-shift breakdown). Returns `{ success: true, data: null }` when the
 * member does not exist. Access is enforced inside getMemberStatsDetail.
 */
export async function getMemberStatsAction(
  group: string,
  userId: string,
): Promise<MemberStatsDetailActionResult> {
  const parsed = activeWorkgroupSchema.safeParse(group);
  if (!parsed.success) {
    return { success: false, error: "Grupo no válido." };
  }

  try {
    const actor = await requireAuthenticatedProfile();
    const detail = await getMemberStatsDetail(actor, parsed.data, userId);
    return { success: true, data: detail };
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return { success: false, error: error.message };
    }
    console.error("getMemberStatsAction failed", error);
    return { success: false, error: "Error inesperado al cargar las estadísticas." };
  }
}