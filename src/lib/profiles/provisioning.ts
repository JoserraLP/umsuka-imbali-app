import { createAdminClient } from "@/lib/supabase/admin";
import type { User } from "@supabase/supabase-js";

export interface MutationResult {
  success: boolean;
  error?: string;
}

/**
 * Splits a Google OAuth "full_name" into a best-effort first/last name,
 * mirroring the logic in umsuka.handle_new_user() (the DB trigger).
 */
function splitFullName(metadata: User["user_metadata"]): { firstName: string; lastName: string } {
  const fullName = String(metadata?.full_name ?? metadata?.name ?? "").trim();
  const [firstPart, ...rest] = fullName.split(" ").filter(Boolean);

  const firstName = (metadata?.given_name as string | undefined)?.trim() || firstPart || "New";
  const lastName =
    (metadata?.family_name as string | undefined)?.trim() || rest.join(" ") || "Member";

  return { firstName, lastName };
}

/**
 * Self-healing fallback for authenticated users who have no row in
 * umsuka.profiles. This should normally never be needed — the
 * umsuka.handle_new_user() DB trigger provisions the row automatically —
 * but it covers the case where that migration was applied *after* a user
 * had already signed up (the trigger only fires on new auth.users
 * inserts), or any other one-off provisioning gap.
 *
 * Uses the admin client (bypasses RLS) because umsuka.profiles has no
 * INSERT policy for the authenticated/anon roles by design — profile
 * creation is intentionally restricted to the trigger and this
 * equivalent server-side path.
 *
 * Kept in its own module, separate from lib/profiles/mutations.ts, so
 * that lib/auth/session.ts can call it without creating a circular
 * import (mutations.ts depends on session.ts for requireAuthenticatedProfile).
 */
export async function ensureProfileExists(user: User): Promise<MutationResult> {
  const { firstName, lastName } = splitFullName(user.user_metadata);
  const admin = createAdminClient();

  const { error } = await admin.from("profiles").upsert(
    {
      id: user.id,
      first_name: firstName,
      last_name: lastName,
      component_type: "member",
      role: "member",
    },
    { onConflict: "id", ignoreDuplicates: true },
  );

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
