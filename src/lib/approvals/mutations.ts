import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { requireAdmin, AuthorizationError } from "@/lib/auth/permissions";
import { notifyUsers } from "@/lib/notifications/emit";
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

  // Sprint 20: notify the approved user (best-effort — a notification
  // failure, even an unexpected throw from the emitter, can never fail
  // the approval).
  try {
    await notifyUsers({
      userIds: [parsed.data.userId],
      type: "profile_approved",
      title: "¡Tu cuenta ha sido aprobada!",
      message: "Ya puedes acceder a la app.",
      link: "/dashboard",
    });
  } catch (err) {
    console.error("approveUser: la notificación falló (no bloqueante):", err);
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
