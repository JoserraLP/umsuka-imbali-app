"use server";

import { resolveUsernameToEmail } from "@/lib/auth/emailless-login";
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
