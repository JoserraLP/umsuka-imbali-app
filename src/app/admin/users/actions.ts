"use server";

import { revalidatePath } from "next/cache";
import { updateMemberRole, updateMemberProfile, setMemberActive } from "@/lib/profiles/mutations";
import type {
  UpdateMemberRoleInput,
  UpdateMemberProfileInput,
  SetMemberActiveInput,
} from "@/lib/profiles/schema";
import type { MutationResult } from "@/lib/profiles/mutations";

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
