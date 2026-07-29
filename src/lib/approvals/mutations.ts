import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { requireAdmin, AuthorizationError } from "@/lib/auth/permissions";
import {
  approveUserSchema,
  suspendUserSchema,
  type ApproveUserInput,
  type SuspendUserInput,
} from "@/lib/approvals/schema";

export interface MutationResult {
  success: boolean;
  error?: string;
}

/**
 * Approves a pending user by setting status = 'active'.
 * Only callable by super_admin or admin.
 * Uses the admin client to bypass RLS (defense-in-depth).
 */
export async function approveUser(input: ApproveUserInput): Promise<MutationResult> {
  const parsed = approveUserSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();

  try {
    requireAdmin(actor.role);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from("profiles")
    .update({ status: "active" })
    .eq("id", parsed.data.userId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Suspends a user by setting status = 'suspended'.
 * Only callable by super_admin or admin.
 */
export async function suspendUser(input: SuspendUserInput): Promise<MutationResult> {
  const parsed = suspendUserSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();

  try {
    requireAdmin(actor.role);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  // Cannot suspend yourself
  if (parsed.data.userId === actor.id) {
    return { success: false, error: "No puedes suspender tu propia cuenta." };
  }

  const admin = createAdminClient();

  const { error } = await admin
    .from("profiles")
    .update({ status: "suspended" })
    .eq("id", parsed.data.userId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
