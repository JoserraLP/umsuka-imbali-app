"use server";

import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/permissions";
import {
  searchShiftMembers,
  type ShiftMemberSearchInput,
  type ShiftMemberSearchPage,
} from "@/lib/shifts/search";

export type ShiftMemberSearchActionResult =
  | { success: true; data: ShiftMemberSearchPage }
  | { success: false; error: string };

const GENERIC_SEARCH_ERROR = "No se pudo completar la búsqueda.";

/**
 * Read-only server action backing the shift member search. The caller
 * must be authenticated; authorization (management full access, lead
 * scoped to their own group, everyone else rejected) is enforced inside
 * searchShiftMembers BEFORE any DB access.
 *
 * Intentionally does NOT call revalidatePath: a pure read must never
 * invalidate the router cache.
 */
export async function searchShiftMembersAction(
  input: ShiftMemberSearchInput,
): Promise<ShiftMemberSearchActionResult> {
  try {
    const actor = await requireAuthenticatedProfile();
    const data = await searchShiftMembers(actor, input);
    return { success: true, data };
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { success: false, error: err.message };
    }
    console.error("searchShiftMembersAction:", err);
    return { success: false, error: GENERIC_SEARCH_ERROR };
  }
}
