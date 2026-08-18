"use server";

import { revalidatePath } from "next/cache";
import { updateSetting, approveUser, suspendUser } from "@/lib/admin/mutations";
import type { UpdateSettingInput } from "@/lib/admin/schema";
import type { ApproveUserInput, SuspendUserInput } from "@/lib/approvals/schema";
import type { MutationResult } from "@/lib/admin/mutations";

/**
 * Admin-panel server actions (Sprint 21). Thin wrappers: permission
 * checks and the audit trail live in src/lib/admin/mutations, so these
 * actions never audit by themselves (no duplicate log rows).
 */

/** Updates a global setting and refreshes the settings page. */
export async function updateSettingAction(input: UpdateSettingInput): Promise<MutationResult> {
  const result = await updateSetting(input);

  if (result.success) {
    revalidatePath("/admin/settings");
  }

  return result;
}

/** Approves a pending user through the admin wrapper (audited once). */
export async function approveUserActionAdmin(input: ApproveUserInput): Promise<MutationResult> {
  const result = await approveUser(input);

  if (result.success) {
    revalidatePath("/admin/users");
    revalidatePath("/admin/registrations");
  }

  return result;
}

/** Suspends a user through the admin wrapper (audited once). */
export async function suspendUserActionAdmin(input: SuspendUserInput): Promise<MutationResult> {
  const result = await suspendUser(input);

  if (result.success) {
    revalidatePath("/admin/users");
    revalidatePath("/admin/registrations");
  }

  return result;
}