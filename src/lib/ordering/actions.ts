"use server";

import { revalidatePath } from "next/cache";
import { saveListOrdering, type MutationResult } from "@/lib/ordering/mutations";
import type { SaveListOrderingInput } from "@/lib/ordering/schema";

export type { MutationResult, SaveListOrderingInput };

/**
 * Persists the caller's sort selection for one listing and refreshes the
 * affected pages. `input` is validated inside saveListOrdering; the row
 * is always scoped to the authenticated actor (see mutations.ts).
 */
export async function saveListOrderingAction(
  input: SaveListOrderingInput,
): Promise<MutationResult> {
  try {
    const result = await saveListOrdering(input.listId, input.sortBy, input.direction);

    if (result.success) {
      revalidatePath("/members");
      revalidatePath("/instruments");
      revalidatePath("/events");
    }

    return result;
  } catch (error) {
    // requireAuthenticatedProfile throws when there is no active session.
    console.error("saveListOrderingAction falló:", error);
    return { success: false, error: "No se pudo guardar la ordenación." };
  }
}
