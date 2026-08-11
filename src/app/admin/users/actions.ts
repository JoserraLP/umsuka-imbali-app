"use server";

import { revalidatePath } from "next/cache";
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
