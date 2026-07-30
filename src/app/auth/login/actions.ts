"use server";

import { resolveUsernameToEmail } from "@/lib/auth/emailless-login";
import { loginWithPassword } from "@/lib/auth/password-service";
import type {
  ResolveUsernameInput,
  ResolveUsernameResult,
} from "@/lib/auth/emailless-schema";
import type {
  LoginInput,
  LoginResult,
} from "@/lib/auth/password-schema";

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
 * Server-side login verification with rate limiting and
 * specific error codes. Called from UsernameLoginForm after
 * a successful username resolution.
 */
export async function loginAction(
  input: LoginInput,
): Promise<LoginResult> {
  return loginWithPassword(input);
}
