"use server";

import { resolveUsernameToEmail } from "@/lib/auth/emailless-login";
import { checkRateLimit, recordLoginAttempt } from "@/lib/auth/password-service";
import type {
  ResolveUsernameInput,
  ResolveUsernameResult,
} from "@/lib/auth/emailless-schema";

/**
 * Resolves a username to an email alias for login.
 * This is a public server action (no auth check) because
 * it is called from the login page before authentication.
 */
export async function resolveUsernameForLogin(
  input: ResolveUsernameInput,
): Promise<ResolveUsernameResult> {
  return resolveUsernameToEmail(input);
}

/**
 * Verifica si el usuario está bloqueado por fuerza bruta.
 * El login real lo hace el cliente con supabase.auth.signInWithPassword()
 * porque el admin client (service_role) no puede verificar credenciales.
 *
 * Devuelve el estado del rate limit para que el cliente decida si procede.
 */
export async function checkLoginRateLimitAction(
  username: string,
): Promise<
  | { allowed: true }
  | { allowed: false; error: string; blockedUntil: string }
> {
  const result = await checkRateLimit(username);
  if (result.blocked) {
    const unlockTime = new Date(result.blockedUntil);
    const timeStr = unlockTime.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return {
      allowed: false,
      error: `Demasiados intentos fallidos. La cuenta estará bloqueada hasta las ${timeStr}.`,
      blockedUntil: result.blockedUntil,
    };
  }
  return { allowed: true };
}

/**
 * Registra un intento de login fallido.
 * Se llama DESPUÉS de que el cliente recibe un error de signInWithPassword.
 */
export async function recordFailedAttemptAction(
  username: string,
): Promise<{
  blocked: boolean;
  error?: string;
  blockedUntil?: string;
}> {
  await recordLoginAttempt(username, false);

  // Verificar si ahora está bloqueado
  const result = await checkRateLimit(username);
  if (result.blocked) {
    const unlockTime = new Date(result.blockedUntil);
    const timeStr = unlockTime.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
    return {
      blocked: true,
      error: `Demasiados intentos fallidos. La cuenta estará bloqueada hasta las ${timeStr}.`,
      blockedUntil: result.blockedUntil,
    };
  }

  return { blocked: false };
}

/**
 * Registra un intento de login exitoso.
 * Se llama DESPUÉS de que el cliente completa signInWithPassword exitosamente.
 */
export async function recordSuccessfulAttemptAction(
  username: string,
): Promise<void> {
  await recordLoginAttempt(username, true);
}
