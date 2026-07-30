import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import {
  createEmaillessAccountSchema,
  type CreateEmaillessAccountInput,
  type CreateEmaillessAccountResult,
} from "@/lib/auth/emailless-schema";

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
 *  4. Calls `umsuka.create_emailless_profile()` (SECURITY DEFINER) which
 *     inserts both the profile and email_alias in a single transaction.
 *
 * If step 4 fails, the auth user is deleted to avoid orphaned records.
 * Step 4 itself is atomic — either both rows are created or neither.
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
    email_confirm: true,
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

  // ── 4. Create profile + email alias via SECURITY DEFINER function ──
  // This single rpc() call handles both inserts atomically and bypasses
  // RLS / table-permission issues by running as the function owner.
  const { error: rpcError } = await admin.rpc("create_emailless_profile", {
    p_id: createdUserId,
    p_first_name: parsed.data.firstName,
    p_last_name: parsed.data.lastName,
    p_username: parsed.data.username,
    p_component_type: parsed.data.componentType,
    p_workgroup: parsed.data.workgroup ?? null,
    p_alias_email: emailAlias,
    p_created_by: actor.id,
  });

  if (rpcError) {
    // Rollback: remove the auth user (the DB function is atomic, so
    // if it failed, no profile or alias was created).
    await admin.auth.admin.deleteUser(createdUserId).catch(() => {});
    return { success: false, error: rpcError.message };
  }

  return {
    success: true,
    credentials: {
      username: parsed.data.username,
      password: parsed.data.password,
    },
  };
}
