import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import {
  resetPasswordSchema,
  changePasswordSchema,
  generateResetTokenSchema,
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

// ── Rate limiting helpers ────────────────────────────────

/**
 * Verifica si un perfil está bloqueado por fuerza bruta.
 * Devuelve false si no está bloqueado, o un objeto con
 * blockedUntil si está bloqueado.
 */
export async function checkRateLimit(
  username: string,
): Promise<{ blocked: false } | { blocked: true; blockedUntil: string }> {
  const admin = createAdminClient();

  // Obtener profile_id desde el username
  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (!profile) {
    return { blocked: false }; // Usuario no encontrado, no bloqueamos
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: isBlocked } = await (admin.rpc as any)("is_login_blocked", {
    p_profile_id: profile.id,
    p_max_attempts: MAX_ATTEMPTS,
    p_window_minutes: WINDOW_MINUTES,
    p_block_minutes: BLOCK_MINUTES,
  });

  if (isBlocked) {
    const blockedUntil = await getBlockedUntil(admin, profile.id);
    return { blocked: true, blockedUntil };
  }

  return { blocked: false };
}

/**
 * Registra un intento de login (éxito o fallo) en la BD.
 */
export async function recordLoginAttempt(
  username: string,
  success: boolean,
): Promise<void> {
  const admin = createAdminClient();

  const { data: profile } = await admin
    .from("profiles")
    .select("id")
    .eq("username", username)
    .maybeSingle();

  if (!profile) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (admin.rpc as any)("record_login_attempt", {
    p_profile_id: profile.id,
    p_success: success,
  });
}

// ── Token generation ─────────────────────────────────────

/**
 * Generate a password reset token (admin only).
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
 * Desbloquea manualmente una cuenta eliminando todos los
 * intentos fallidos de login. Solo super_admin.
 */
export async function adminUnlockAccount(
  profileId: string,
): Promise<{ success: boolean; error?: string }> {
  const actor = await requireAuthenticatedProfile();
  if (actor.role !== "super_admin") {
    return {
      success: false,
      error: "Solo el super_admin puede desbloquear cuentas.",
    };
  }

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (admin.rpc as any)("admin_unlock_account", {
    p_profile_id: profileId,
  });

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Reset password using a one-time token.
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

// ── Change password ──────────────────────────────────────

/**
 * Change password for the currently authenticated user.
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

  // Verify current password — usamos el server client con anon key
  // para hacer el signIn real (no el admin client con service_role)
  const {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    data: signInResponse,
    error: verifyError,
  } = await admin.auth.signInWithPassword({
    email: alias.alias_email,
    password: parsed.data.currentPassword,
  });

  if (verifyError) {
    return {
      success: false,
      error: "La contraseña actual no es correcta.",
    };
  }

  // Update password via admin API
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

async function sha256(message: string): Promise<string> {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function getBlockedUntil(
  admin: ReturnType<typeof createAdminClient>,
  profileId: string,
): Promise<string> {
  const { data: lastAttempt } = await admin
    .from("password_attempts")
    .select("created_at")
    .eq("profile_id", profileId)
    .eq("success", false)
    .order("created_at", { ascending: false } satisfies Record<string, unknown>)
    .limit(1)
    .maybeSingle();

  const blockEnd =
    lastAttempt && (lastAttempt as { created_at: string }).created_at
      ? new Date(
          new Date(
            (lastAttempt as { created_at: string }).created_at,
          ).getTime() + BLOCK_MINUTES * 60 * 1000,
        )
      : new Date(Date.now() + BLOCK_MINUTES * 60 * 1000);

  return blockEnd.toISOString();
}
