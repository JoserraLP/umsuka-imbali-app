import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  resolveUsernameSchema,
  type ResolveUsernameInput,
  type ResolveUsernameResult,
} from "@/lib/auth/emailless-schema";

/**
 * Resolves a username to the internal email alias used for
 * Supabase Auth. This is a **public** helper — called from the
 * login page before the user has a session.
 *
 * The admin client is used here because the email_aliases RLS
 * policy only permits super_admin access. That is intentional:
 * username → alias resolution is an internal server-side
 * operation, not meant to be queried directly via the public
 * API.
 */
export async function resolveUsernameToEmail(
  input: ResolveUsernameInput,
): Promise<ResolveUsernameResult> {
  const parsed = resolveUsernameSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  const admin = createAdminClient();

  // 1. Find the profile by username
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("id, auth_method")
    .eq("username", parsed.data.username)
    .maybeSingle();

  if (profileError) {
    return { success: false, error: profileError.message };
  }

  if (!profile) {
    return { success: false, error: "Usuario no encontrado." };
  }

  // 2. Verify the account uses email_alias auth
  if (profile.auth_method !== "email_alias") {
    return {
      success: false,
      error: "Este usuario no utiliza autenticación por usuario/contraseña.",
    };
  }

  // 3. Get the email alias
  const { data: alias, error: aliasError } = await admin
    .from("email_aliases")
    .select("alias_email")
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (aliasError) {
    return { success: false, error: aliasError.message };
  }

  if (!alias) {
    return {
      success: false,
      error: "Alias de correo no encontrado para este usuario.",
    };
  }

  return {
    success: true,
    emailAlias: alias.alias_email,
  };
}
