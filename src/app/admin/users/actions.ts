"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import {
  updateMemberProfile,
  updateMemberComponentType,
  updateMemberWorkgroup,
} from "@/lib/profiles/mutations";
import { updateUserRole, setUserActive, logAuditAction } from "@/lib/admin/mutations";
import { deleteAccountPermanently } from "@/lib/auth/delete-account";
import type {
  UpdateMemberRoleInput,
  UpdateMemberProfileInput,
  SetMemberActiveInput,
  SetMemberComponentTypeInput,
  SetMemberWorkgroupInput,
} from "@/lib/profiles/schema";
import type { MutationResult } from "@/lib/admin/mutations";
import type { AdminAuditAction } from "@/lib/admin/schema";
import { createEmaillessAccount } from "@/lib/auth/admin-create";
import { generateResetToken, adminUnlockAccount } from "@/lib/auth/password-service";
import type {
  CreateEmaillessAccountInput,
  CreateEmaillessAccountResult,
} from "@/lib/auth/emailless-schema";
import type { GenerateResetTokenInput, GenerateResetTokenResult } from "@/lib/auth/password-schema";

/**
 * Friendliest-effort audit helper: resolves the actor and writes ONE
 * audit row. Never throws — an audit failure (or a missing session right
 * after a successful mutation) must not turn a successful mutation into
 * a failed one. Mirrors the best-effort contract of logAuditAction.
 */
async function auditAsActor(input: {
  action: AdminAuditAction;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown> | null;
}): Promise<void> {
  try {
    const actor = await requireAuthenticatedProfile();
    await logAuditAction({
      actorId: actor.id,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      details: input.details ?? null,
    });
  } catch (error) {
    console.error("auditAsActor: no se pudo registrar la auditoría:", error);
  }
}

/**
 * Delegates to the admin wrapper (audit already inside) — no duplicate
 * audit rows here.
 */
export async function updateMemberRoleAction(
  input: UpdateMemberRoleInput,
): Promise<MutationResult> {
  const result = await updateUserRole(input);

  if (result.success) {
    revalidatePath("/admin/users");
  }

  return result;
}

export async function updateMemberProfileAction(
  input: UpdateMemberProfileInput,
): Promise<MutationResult> {
  const result = await updateMemberProfile(input);

  if (result.success) {
    await auditAsActor({
      action: "user.profile_updated",
      entityType: "profile",
      entityId: input.userId,
    });
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${input.userId}`);
  }

  return result;
}

/**
 * Delegates to the admin wrapper (audit already inside) — no duplicate
 * audit rows here.
 */
export async function setMemberActiveAction(input: SetMemberActiveInput): Promise<MutationResult> {
  const result = await setUserActive(input);

  if (result.success) {
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${input.userId}`);
  }

  return result;
}

export async function updateMemberComponentTypeAction(
  input: SetMemberComponentTypeInput,
): Promise<MutationResult> {
  const result = await updateMemberComponentType(input);

  if (result.success) {
    await auditAsActor({
      action: "user.component_type_changed",
      entityType: "profile",
      entityId: input.userId,
    });
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${input.userId}`);
  }

  return result;
}

export async function updateMemberWorkgroupAction(
  input: SetMemberWorkgroupInput,
): Promise<MutationResult> {
  const result = await updateMemberWorkgroup(input);

  if (result.success) {
    await auditAsActor({
      action: "user.workgroup_changed",
      entityType: "profile",
      entityId: input.userId,
    });
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${input.userId}`);
  }

  return result;
}

export async function createEmaillessAccountAction(
  input: CreateEmaillessAccountInput,
): Promise<CreateEmaillessAccountResult> {
  const result = await createEmaillessAccount(input);

  if (result.success) {
    await auditAsActor({
      action: "user.emailless_created",
      entityType: "auth.user",
      details: { username: input.username },
    });
    revalidatePath("/admin/users");
    revalidatePath("/admin/registrations");
  }

  return result;
}

export async function generateResetTokenAction(
  input: GenerateResetTokenInput,
): Promise<GenerateResetTokenResult> {
  const result = await generateResetToken(input);

  if (result.success) {
    await auditAsActor({
      action: "user.password_reset_generated",
      entityType: "profile",
      entityId: input.profileId,
    });
    revalidatePath("/admin/users");
    revalidatePath("/admin/registrations");
  }

  return result;
}

export async function unlockAccountAction(
  profileId: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await adminUnlockAccount(profileId);

  if (result.success) {
    await auditAsActor({
      action: "user.account_unlocked",
      entityType: "profile",
      entityId: profileId,
    });
    revalidatePath("/admin/users");
  }

  return result;
}

const COMPONENT_LEAD_UNIQUE_VIOLATION_MESSAGE =
  "Ya existe un responsable designado para ese componente. Quítale el cargo al responsable actual primero.";

const COMPONENT_LEAD_INACTIVE_MEMBER_MESSAGE =
  "El miembro debe estar activo para ser designado responsable.";

/**
 * True when a Supabase/PostgREST error is the partial unique index
 * violation on idx_profiles_component_lead_for: primary check is the
 * error code 23505; the fallback matches the index name only, so
 * unrelated duplicate-key errors are never misclassified.
 */
function isComponentLeadUniqueViolation(error: {
  code?: string;
  message?: string;
  details?: string;
}): boolean {
  if (error.code === "23505") return true;
  return /idx_profiles_component_lead_for/i.test(error.message ?? "");
}

/**
 * Super-admin only: designates (or removes, when component is null) the
 * responsable of a component (music/dance). The DB partial unique index
 * guarantees at most one lead per component; a violation is converted
 * into a friendly Spanish message for the UI.
 *
 * UX guard (no security impact — RLS/session already block inactive
 * users): a designation requires the target to be active (status
 * "active" and is_active true). Clearing a designation is always
 * allowed, so an admin can un-assign a suspended lead before appointing
 * the replacement.
 *
 * Audits `user.component_lead_changed` once on success.
 */
export async function setComponentLeadAction(
  userId: string,
  component: "music" | "dance" | null,
): Promise<{ success: boolean; error?: string }> {
  try {
    const actor = await requireAuthenticatedProfile();

    if (actor.role !== "super_admin") {
      return {
        success: false,
        error: "Solo el super admin puede designar responsables de componente.",
      };
    }

    const supabase = await createClient();

    if (component !== null) {
      const { data: target, error: targetError } = await supabase
        .from("profiles")
        .select("id, status, is_active")
        .eq("id", userId)
        .maybeSingle();

      if (targetError) {
        return { success: false, error: targetError.message };
      }

      if (!target || target.status !== "active" || !target.is_active) {
        return { success: false, error: COMPONENT_LEAD_INACTIVE_MEMBER_MESSAGE };
      }
    }

    const { error } = await supabase
      .from("profiles")
      .update({ component_lead_for: component })
      .eq("id", userId);

    if (error) {
      if (isComponentLeadUniqueViolation(error)) {
        return { success: false, error: COMPONENT_LEAD_UNIQUE_VIOLATION_MESSAGE };
      }
      return { success: false, error: error.message };
    }

    await logAuditAction({
      actorId: actor.id,
      action: "user.component_lead_changed",
      entityType: "profile",
      entityId: userId,
      details: { component },
    });

    revalidatePath("/admin/users");
    return { success: true };
  } catch (error) {
    console.error("setComponentLeadAction failed", error);
    return { success: false, error: "Error inesperado al actualizar el responsable." };
  }
}

/**
 * Confirmation gate for the permanent account deletion: the caller must
 * type the word ELIMINAR (trimmed, case-insensitive) — the double-step
 * confirmation the UI enforces in the AlertDialog.
 */
const deleteAccountPermanentlySchema = z
  .object({
    userId: z.string().uuid(),
    confirmation: z.string(),
  })
  .refine((data) => data.confirmation.trim().toUpperCase() === "ELIMINAR", {
    message: "Debes escribir ELIMINAR para confirmar.",
    path: ["confirmation"],
  });
export type DeleteAccountPermanentlyActionInput = z.infer<typeof deleteAccountPermanentlySchema>;

/**
 * Super-admin only: permanently deletes a member account (auth user,
 * profile and related data). Thin wrapper over
 * deleteAccountPermanently() — authorization and the audit trail live in
 * the service. The confirmation field is validated here (double step)
 * and the affected admin views are revalidated on success only.
 */
export async function deleteAccountPermanentlyAction(input: {
  userId: string;
  confirmation: string;
}): Promise<MutationResult> {
  try {
    const parsed = deleteAccountPermanentlySchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues.map((issue) => issue.message).join(", "),
      };
    }

    const result = await deleteAccountPermanently(parsed.data.userId);

    if (result.success) {
      revalidatePath("/admin/users");
      revalidatePath("/admin/registrations");
    }

    return result;
  } catch (error) {
    console.error("deleteAccountPermanentlyAction failed", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Error inesperado al eliminar la cuenta.",
    };
  }
}
