import { createClient } from "@/lib/supabase/server";
import { parseListOrdering, type ListOrdering } from "@/lib/ordering/schema";

/**
 * Reads the caller's persisted list ordering. Returns `{}` (app
 * defaults) when there is no row yet.
 *
 * SECURITY: `userId` MUST come from the authenticated session of the
 * calling server component (e.g. `profile.id` after the auth gate) —
 * never from client input. RLS own-row policies are the second line of
 * defense; this contract is the first.
 *
 * Fail-open on DB/network errors: a listing must never go down because
 * preferences could not be read, so any failure logs and degrades to
 * the default sort.
 */
export async function getListOrdering(userId: string): Promise<ListOrdering> {
  try {
    const supabase = await createClient();

    const { data, error } = await supabase
      .from("user_preferences")
      .select("list_ordering")
      .eq("user_id", userId)
      .maybeSingle();

    if (error) {
      console.error("getListOrdering: error al leer user_preferences:", error.message);
      return {};
    }

    if (!data) return {};

    return parseListOrdering(data.list_ordering);
  } catch (error) {
    console.error("getListOrdering: fallo inesperado al leer preferencias:", error);
    return {};
  }
}
