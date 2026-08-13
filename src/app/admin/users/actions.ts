"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { updateMemberRole, updateMemberProfile, setMemberActive, updateMemberComponentType, updateMemberWorkgroup } from "@/lib/profiles/mutations";
import type {
  UpdateMemberRoleInput,
  UpdateMemberProfileInput,
  SetMemberActiveInput,
  SetMemberComponentTypeInput,
  SetMemberWorkgroupInput,
} from "@/lib/profiles/schema";
import type { MutationResult } from "@/lib/profiles/mutations";
import { createEmaillessAccount } from "@/lib/auth/admin-create";
import { generateResetToken, adminUnlockAccount } from "@/lib/auth/password-service";
import type {
  CreateEmaillessAccountInput,
  CreateEmaillessAccountResult,
} from "@/lib/auth/emailless-schema";
import type {
  GenerateResetTokenInput,
  GenerateResetTokenResult,
} from "@/lib/auth/password-schema";

export async function updateMemberRoleAction(
  input: UpdateMemberRoleInput,
): Promise<MutationResult> {
  const result = await updateMemberRole(input);

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
    revalidatePath("/admin/users");
    revalidatePath(`/admin/users/${input.userId}`);
  }

  return result;
}

export async function setMemberActiveAction(
  input: SetMemberActiveInput,
): Promise<MutationResult> {
  const result = await setMemberActive(input);

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
    revalidatePath("/admin/users");
    revalidatePath("/admin/registrations");
  }

  return result;
}

export async function generateResetTokenAction(
  input: GenerateResetTokenInput,
): Promise<GenerateResetTokenResult> {
  return generateResetToken(input);
}

export async function unlockAccountAction(
  profileId: string,
): Promise<{ success: boolean; error?: string }> {
  const result = await adminUnlockAccount(profileId);

  if (result.success) {
    const { revalidatePath } = await import("next/cache");
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

    revalidatePath("/admin/users");
    return { success: true };
  } catch (error) {
    console.error("setComponentLeadAction failed", error);
    return { success: false, error: "Error inesperado al actualizar el responsable." };
  }
}
