import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveUsernameToEmail } from "@/lib/auth/emailless-login";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import {
  loginSchema,
  resetPasswordSchema,
  changePasswordSchema,
  generateResetTokenSchema,
  type LoginInput,
  type LoginResult,
  type ResetPasswordInput,
  type ResetPasswordResult,
  type ChangePasswordInput,
  type GenerateResetTokenInput,
  type GenerateResetTokenResult,
} from "@/lib/auth/password-schema";
import type { ChangePasswordResult } from "@/lib/auth/emailless-schema";

// ── Constants ────────────────────────────────────────────
const MAX_ATTEMPTS = 5;
const WINDOW_MINUTES = 15;
const BLOCK_MINUTES = 30;
const TOKEN_EXPIRY_HOURS = 24;

// ── Public functions ─────────────────────────────────────

/**
 * Attempt to log in with username + password.
 *
 * Server-side verification: resolves username → email alias, checks
 * rate limiting, attempts signInWithPassword (using the admin client),
 * records the attempt, and returns a specific error code on failure.
 *
 * On success the client must still call signInWithPassword() from the
 * browser to establish the user session. This two-step design keeps
 * the rate-limiting logic on the server while leaving session
 * management to the client-side Supabase client (which handles cookies).
 */
export async function loginWithPassword(
  input: LoginInput,
): Promise<LoginResult> {
  // ── 1. Validate input ────────────────────────────────
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(", "),
      errorCode: "invalid_credentials",
    };
  }

  const admin = createAdminClient();

  // ── 2. Resolve username → profile + email alias ──────
  const resolveResult = await resolveUsernameToEmail({
    username: parsed.data.username,
  });
  if (!resolveResult.success) {
    return {
      success: false,
      error: resolveResult.error ?? "Usuario no encontrado.",
      errorCode: resolveResult.errorCode === "wrong_auth_method"
        ? "wrong_auth_method"
        : "account_not_found",
    };
  }

  // ── 3. Get profile_id ────────────────────────────────
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("username", parsed.data.username)
    .maybeSingle();

  if (!profile) {
    return {
      success: false,
      error: "Usuario no encontrado.",
      errorCode: "account_not_found",
    };
  }

  // ── 4. Check rate limit ─────────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: isBlocked } = await (admin.rpc as any)("is_login_blocked", {
    p_profile_id: profile.id,
    p_max_attempts: MAX_ATTEMPTS,
    p_window_minutes: WINDOW_MINUTES,
    p_block_minutes: BLOCK_MINUTES,
  });

  if (isBlocked) {
    const blockedUntil = await getBlockedUntil(admin, profile.id);
    return {
      success: false,
      error: getBlockedMessage(blockedUntil),
      errorCode: "account_locked",
      blockedUntil,
    };
  }

  // ── 5. Attempt authentication ────────────────────────
  // Using the admin client here simply verifies the credentials.
  // The returned session belongs to the target user within the
  // admin client context — we ignore it. The browser client will
  // establish its own session after this succeeds.
  const { error: signInError } = await admin.auth.signInWithPassword({
    email: resolveResult.emailAlias!,
    password: parsed.data.password,
  });

  // ── 6. Record attempt (success/failure) ──────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.rpc as any)("record_login_attempt", {
    p_profile_id: profile.id,
    p_success: !signInError,
  });

  if (signInError) {
    // Check if the account might be blocked now
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: nowBlocked } = await (admin.rpc as any)("is_login_blocked", {
      p_profile_id: profile.id,
      p_max_attempts: MAX_ATTEMPTS,
      p_window_minutes: WINDOW_MINUTES,
      p_block_minutes: BLOCK_MINUTES,
    });

    if (nowBlocked) {
      const blockedUntil = await getBlockedUntil(admin, profile.id);
      return {
        success: false,
        error: getBlockedMessage(blockedUntil),
        errorCode: "account_locked",
        blockedUntil,
      };
    }

    return {
      success: false,
      error: "Usuario o contraseña incorrectos.",
      errorCode: "invalid_credentials",
    };
  }

  return { success: true };
}

/**
 * Generate a password reset token (admin only).
 *
 * Only super_admin can generate tokens. The raw token is returned
 * so the admin can share it with the user. The database stores only
 * the SHA-256 hash of the token.
 */
export async function generateResetToken(
  input: GenerateResetTokenInput,
): Promise<GenerateResetTokenResult> {
  const parsed = generateResetTokenSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  // ── Authorization: only super_admin ──────────────────
  const actor = await requireAuthenticatedProfile();
  if (actor.role !== "super_admin") {
    return {
      success: false,
      error: "Solo el super_admin puede generar tokens de restablecimiento.",
    };
  }

  const admin = createAdminClient();
  const rawToken = crypto.randomUUID();
  const tokenHash = await sha256(rawToken);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.from("password_reset_tokens") as any).insert({
    profile_id: parsed.data.profileId,
    token_hash: tokenHash,
    expires_at: expiresAt.toISOString(),
    created_by: actor.id,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return {
    success: true,
    token: rawToken,
    expiresAt: expiresAt.toISOString(),
  };
}

/**
 * Reset password using a one-time token.
 *
 * The token is consumed atomically: if two requests arrive with
 * the same token, only the first succeeds.
 */
export async function resetPassword(
  input: ResetPasswordInput,
): Promise<ResetPasswordResult> {
  const parsed = resetPasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  const admin = createAdminClient();
  const tokenHash = await sha256(parsed.data.token);

  // Consume token via RPC (atomic operation)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: profileId, error: consumeError } = await (admin.rpc as any)(
    "consume_password_reset_token",
    { p_token_hash: tokenHash },
  );

  if (consumeError || !profileId) {
    return {
      success: false,
      error: "Token inválido o expirado.",
    };
  }

  // Update password via admin API
  const { error: updateError } = await admin.auth.admin.updateUserById(
    profileId as string,
    { password: parsed.data.password },
  );

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  return { success: true };
}

/**
 * Change password for the currently authenticated user.
 *
 * Verifies the current password before allowing the change.
 */
export async function changePassword(
  input: ChangePasswordInput,
): Promise<ChangePasswordResult> {
  const parsed = changePasswordSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  const actor = await requireAuthenticatedProfile();

  const admin = createAdminClient();

  // Get the email alias for this profile
  const { data: alias } = await admin
    .from("email_aliases")
    .select("alias_email")
    .eq("profile_id", actor.id)
    .maybeSingle();

  if (!alias) {
    return {
      success: false,
      error: "No se encontró el alias de correo para este usuario.",
    };
  }

  // Verify current password
  const { error: verifyError } = await admin.auth.signInWithPassword({
    email: alias.alias_email,
    password: parsed.data.currentPassword,
  });

  if (verifyError) {
    return {
      success: false,
      error: "La contraseña actual no es correcta.",
    };
  }

  // Update password
  const { error: updateError } = await admin.auth.admin.updateUserById(
    actor.id,
    { password: parsed.data.newPassword },
  );

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  return { success: true };
}

// ── Helpers ─────────────────────────────────────────────

/**
 * SHA-256 hash function for token hashing.
 * Uses Web Crypto API (available in Node 18+ and all modern runtimes).
 */
async function sha256(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Get the ISO timestamp when the block on an account ends.
 */
async function getBlockedUntil(
  admin: ReturnType<typeof createAdminClient>,
  profileId: string,
): Promise<string> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: lastAttempt } = await (admin
    .from("password_attempts") as any)
    .select("created_at")
    .eq("profile_id", profileId)
    .eq("success", false)
    .order("created_at", { ascending: false } as any)
    .limit(1)
    .maybeSingle();

  const blockEnd = lastAttempt && (lastAttempt as { created_at: string }).created_at
    ? new Date(
        new Date((lastAttempt as { created_at: string }).created_at).getTime() +
          BLOCK_MINUTES * 60 * 1000,
      )
    : new Date(Date.now() + BLOCK_MINUTES * 60 * 1000);

  return blockEnd.toISOString();
}

/**
 * Format a human-readable blocked message with the unlock time.
 */
function getBlockedMessage(blockedUntil: string): string {
  const unlockTime = new Date(blockedUntil);
  const timeStr = unlockTime.toLocaleTimeString("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `Demasiados intentos fallidos. La cuenta estará bloqueada hasta las ${timeStr}.`;
}
