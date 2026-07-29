"use server";

import { revalidatePath } from "next/cache";
import { updateMemberRole, updateMemberProfile, setMemberActive } from "@/lib/profiles/mutations";
import type {
  UpdateMemberRoleInput,
  UpdateMemberProfileInput,
  SetMemberActiveInput,
} from "@/lib/profiles/schema";
import type { MutationResult } from "@/lib/profiles/mutations";
import { createEmaillessAccount } from "@/lib/auth/admin-create";
import type {
  CreateEmaillessAccountInput,
  CreateEmaillessAccountResult,
} from "@/lib/auth/emailless-schema";

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
