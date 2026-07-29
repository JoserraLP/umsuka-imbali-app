import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import {
  createEmaillessAccountSchema,
  type CreateEmaillessAccountInput,
  type CreateEmaillessAccountResult,
} from "@/lib/auth/emailless-schema";
import type { Database } from "@/types/database.types";

type ProfileInsert = Database["umsuka"]["Tables"]["profiles"]["Insert"];

const EMAIL_ALIAS_DOMAIN = "umsuka.internal";

/**
 * Generates an internal email alias that is never exposed to any user.
 * Format: user-{random-uuid}@umsuka.internal
 */
function generateEmailAlias(): string {
  const uuid = crypto.randomUUID();
  return `user-${uuid}@${EMAIL_ALIAS_DOMAIN}`;
}

/**
 * Creates a new auth user + profile for a member who does not have
 * an email address. The flow:
 *
 *  1. Validates input and checks that the actor is super_admin.
 *  2. Generates a UUID email alias (`user-{uuid}@umsuka.internal`).
 *  3. Calls `supabase.auth.admin.createUser()` with the alias + password.
 *  4. Creates a profile row with `auth_method = 'email_alias'`.
 *  5. Records the alias in `umsuka.email_aliases`.
 *
 * If any step after (3) fails, earlier mutations are rolled back
 * (auth user deleted, profile deleted) to avoid orphaned records.
 */
export async function createEmaillessAccount(
  input: CreateEmaillessAccountInput,
): Promise<CreateEmaillessAccountResult> {
  // ── 1. Validate input ──────────────────────────────────
  const parsed = createEmaillessAccountSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  // ── 2. Authorization — only super_admin ────────────────
  const actor = await requireAuthenticatedProfile();

  if (actor.role !== "super_admin") {
    return {
      success: false,
      error: "Solo el super_admin puede crear cuentas sin correo electrónico.",
    };
  }

  const admin = createAdminClient();
  const emailAlias = generateEmailAlias();

  // ── 3. Create Supabase Auth user ──────────────────────
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email: emailAlias,
    password: parsed.data.password,
    email_confirm: true, // auto-confirm — no email to send
    user_metadata: {
      username: parsed.data.username,
      auth_method: "email_alias",
    },
  });

  if (authError) {
    return {
      success: false,
      error: authError.message.includes("already registered")
        ? "El alias de correo generado ya existe. Inténtalo de nuevo."
        : authError.message,
    };
  }

  const createdUserId = authData.user.id;

  // ── 4. Create profile row ──────────────────────────────
  const profileInsert: ProfileInsert = {
    id: createdUserId,
    first_name: parsed.data.firstName,
    last_name: parsed.data.lastName,
    username: parsed.data.username,
    component_type: parsed.data.componentType,
    role: "member",
    status: "pending",
    auth_method: "email_alias",
    is_active: true,
  };

  if (parsed.data.workgroup && parsed.data.workgroup !== "ninguno") {
    profileInsert.workgroup = parsed.data.workgroup;
  }

  // Use upsert to handle the edge case where handle_new_user() DB trigger
  // (fired by admin.createUser() above) already created a profile row
  // with default values. Upsert will update that row with the correct
  // values (auth_method, username, workgroup, etc.).
  const { error: profileError } = await admin
    .from("profiles")
    .upsert(profileInsert, { onConflict: "id", ignoreDuplicates: false });

  if (profileError) {
    // Rollback: remove the auth user we just created
    await admin.auth.admin.deleteUser(createdUserId).catch(() => {});
    return { success: false, error: profileError.message };
  }

  // ── 5. Record email alias ──────────────────────────────
  const { error: aliasError } = await admin.from("email_aliases").insert({
    profile_id: createdUserId,
    alias_email: emailAlias,
    created_by: actor.id,
  });

  if (aliasError) {
    // Rollback: delete profile + auth user
    try { await admin.from("profiles").delete().eq("id", createdUserId); } catch { /* rollback best-effort */ }
    await admin.auth.admin.deleteUser(createdUserId).catch(() => {});
    return { success: false, error: aliasError.message };
  }

  return {
    success: true,
    credentials: {
      username: parsed.data.username,
      password: parsed.data.password,
    },
  };
}
