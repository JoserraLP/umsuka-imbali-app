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

/**
 * True when a Supabase/PostgREST error is the partial unique index
 * violation on idx_profiles_component_lead_for (error code 23505 or a
 * "duplicate key" message naming the index).
 */
function isComponentLeadUniqueViolation(error: {
  code?: string;
  message?: string;
  details?: string;
}): boolean {
  if (error.code === "23505") return true;
  const message = error.message ?? "";
  return /idx_profiles_component_lead_for/i.test(message) || /duplicate key/i.test(message);
}

/**
 * Super-admin only: designates (or removes, when component is null) the
 * responsable of a component (music/dance). The DB partial unique index
 * guarantees at most one lead per component; a violation is converted
 * into a friendly Spanish message for the UI.
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
