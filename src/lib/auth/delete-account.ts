import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { logAuditAction } from "@/lib/admin/mutations";

/**
 * Server-side service for the permanent account deletion (Sprint 22).
 * Only a super admin may delete accounts; the account owner is always
 * protected (a super admin cannot delete themselves).
 *
 * Deletion flow (each step that touches infrastructure reports its own
 * error through a typed `DeleteAccountResult`; like the other services
 * in this repo, `requireAuthenticatedProfile()` throws for a missing
 * session — the server action catches that and returns a typed error):
 *   1. Validate the userId (uuid).
 *   2. Resolve the actor and require role super_admin.
 *   3. Reject self-deletion.
 *   4. Read the target profile (id, names, role) through the admin
 *      client — RLS would hide nothing here, but the maybeSingle() makes
 *      the "does the account exist" check a single source of truth.
 *   5. SOFT-DELETE the profile (`deleted_at = now()`): the account
 *      vanishes from every read path immediately (is_active_member() +
 *      profiles SELECT policy + app-layer queries in migration 0054).
 *   6. Purge password_reset_tokens created by the target (their
 *      `created_by` FK references profiles(id) with NO ACTION and would
 *      block the physical delete).
 *   7. DELETE the auth user via `admin.auth.admin.deleteUser()` — the
 *      profiles.row is removed by the `on delete cascade` FK and every
 *      other FK either cascades or sets null (migration 0054).
 *      If this step fails, the profile stays soft-deleted (the account
 *      is disabled) until a re-attempt.
 *   8. Audit `user.deleted` once — best-effort (logAuditAction never
 *      throws, wrapped in try/catch for defense in depth).
 */

export const deleteAccountSchema = z.object({
  userId: z.string().uuid("El id de usuario no es válido."),
});
export type DeleteAccountInput = z.infer<typeof deleteAccountSchema>;

export interface DeleteAccountResult {
  success: boolean;
  error?: string;
}

export async function deleteAccountPermanently(userId: string): Promise<DeleteAccountResult> {
  // ── 1. Validate input ──────────────────────────────────
  const parsed = deleteAccountSchema.safeParse({ userId });
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  // ── 2. Authorization — only super_admin ────────────────
  const actor = await requireAuthenticatedProfile();

  if (actor.role !== "super_admin") {
    return { success: false, error: "Solo el super admin puede eliminar cuentas." };
  }

  // ── 3. Self-deletion guard ─────────────────────────────
  if (parsed.data.userId === actor.id) {
    return { success: false, error: "No puedes eliminar tu propia cuenta." };
  }

  const admin = createAdminClient();

  // ── 4. Read the target profile ─────────────────────────
  const { data: target, error: readError } = await admin
    .from("profiles")
    .select("id, first_name, last_name, role")
    .eq("id", parsed.data.userId)
    .maybeSingle();

  if (readError) {
    return { success: false, error: readError.message };
  }

  if (!target) {
    return { success: false, error: "El usuario no existe." };
  }

  // ── 5. Soft-delete the profile (safeguard) ─────────────
  const { error: softDeleteError } = await admin
    .from("profiles")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", parsed.data.userId);

  if (softDeleteError) {
    return { success: false, error: softDeleteError.message };
  }

  // ── 6. Purge reset tokens created by the target ─────────
  const { error: tokensError } = await admin
    .from("password_reset_tokens")
    .delete()
    .eq("created_by", parsed.data.userId);

  if (tokensError) {
    return { success: false, error: tokensError.message };
  }

  // ── 7. Physical deletion of the auth user ──────────────
  const { error: deleteError } = await admin.auth.admin.deleteUser(parsed.data.userId);

  if (deleteError) {
    // The profile is already soft-deleted: the account stays disabled.
    return { success: false, error: deleteError.message };
  }

  // ── 8. Audit (best-effort, never fails the mutation) ───
  try {
    await logAuditAction({
      actorId: actor.id,
      action: "user.deleted",
      entityType: "auth.user",
      entityId: parsed.data.userId,
      details: {
        firstName: target.first_name,
        lastName: target.last_name,
        role: target.role,
      },
    });
  } catch (err) {
    console.error("deleteAccountPermanently: fallo de auditoría (se ignora):", err);
  }

  return { success: true };
}
