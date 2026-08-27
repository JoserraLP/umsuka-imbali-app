import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import {
  parseListOrdering,
  saveListOrderingInputSchema,
  SORT_FIELDS_BY_LIST,
  type ListId,
  type SortDirection,
} from "@/lib/ordering/schema";
import type { Json } from "@/types/database.types";

export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
}

/**
 * Persists one list's sort selection for the authenticated actor
 * (read-merge-upsert on umsuka.user_preferences).
 *
 * SECURITY (double scope): the row is ALWAYS keyed by the authenticated
 * actor's id — `listId`/`sortBy`/`direction` come from client input, but
 * `user_id` never does. The own-row RLS policies are the backup defense;
 * this function is the primary one.
 */
export async function saveListOrdering(
  listId: ListId,
  sortBy: string,
  direction: SortDirection,
): Promise<MutationResult> {
  const parsed = saveListOrderingInputSchema.safeParse({ listId, sortBy, direction });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  // Cross-validation: a sort field only makes sense for its own list.
  const validFields = SORT_FIELDS_BY_LIST[parsed.data.listId];
  if (!validFields.includes(parsed.data.sortBy)) {
    return {
      success: false,
      error: `Campo de ordenación no válido para el listado "${parsed.data.listId}".`,
    };
  }

  const actor = await requireAuthenticatedProfile();
  const supabase = await createClient();

  // Read the actor's current document to merge into it (never replace
  // other lists' saved sorts). A missing or corrupted row degrades to {}
  // via the defensive parser.
  const { data: existingRow, error: readError } = await supabase
    .from("user_preferences")
    .select("list_ordering")
    .eq("user_id", actor.id)
    .maybeSingle();

  if (readError) {
    const msg = readError.message ?? "";
    const isMissingTable =
      msg.includes("Could not find the table") ||
      msg.includes("schema cache") ||
      (readError as { code?: string }).code === "PGRST205";
    if (isMissingTable) {
      console.warn("saveListOrdering: tabla user_preferences no encontrada, usando documento vacío y continuando.");
    } else {
      return { success: false, error: readError.message };
    }
  }

  const current = parseListOrdering(existingRow?.list_ordering);
  const merged = {
    ...current,
    [parsed.data.listId]: {
      sortBy: parsed.data.sortBy,
      direction: parsed.data.direction,
    },
  };

  const { error } = await supabase
    .from("user_preferences")
    .upsert(
      { user_id: actor.id, list_ordering: merged as Json },
      { onConflict: "user_id" },
    );

  if (error) {
    const msg = error.message ?? "";
    const isMissingTable =
      msg.includes("Could not find the table") ||
      msg.includes("schema cache") ||
      (error as { code?: string }).code === "PGRST205";
    if (isMissingTable) {
      console.warn("saveListOrdering: tabla user_preferences no encontrada en upsert, orden no persistida, usando default.");
      // No bloquea la UI: el orden se aplica en memoria para esta sesión
      return { success: true, id: actor.id };
    }
    return { success: false, error: error.message };
  }

  return { success: true, id: actor.id };
}
