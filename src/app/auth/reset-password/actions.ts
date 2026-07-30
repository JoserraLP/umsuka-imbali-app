"use server";

import { resetPassword } from "@/lib/auth/password-service";
import type {
  ResetPasswordInput,
  ResetPasswordResult,
} from "@/lib/auth/password-schema";

/**
 * Server action to reset password using a one-time token.
 * Validates the token, consumes it atomically, and updates
 * the password in Supabase Auth.
 */
export async function resetPasswordAction(
  input: ResetPasswordInput,
): Promise<ResetPasswordResult> {
  return resetPassword(input);
}
