"use server";

import { revalidatePath } from "next/cache";
import { updateOwnProfile, setMyWorkgroup } from "@/lib/profiles/mutations";
import type { UpdateOwnProfileInput, SetMyWorkgroupInput } from "@/lib/profiles/schema";
import type { MutationResult } from "@/lib/profiles/mutations";

export async function updateOwnProfileAction(
  input: UpdateOwnProfileInput,
): Promise<MutationResult> {
  const result = await updateOwnProfile(input);

  if (result.success) {
    revalidatePath("/profile");
    revalidatePath("/dashboard");
  }

  return result;
}

export async function setMyWorkgroupAction(input: SetMyWorkgroupInput): Promise<MutationResult> {
  const result = await setMyWorkgroup(input);

  if (result.success) {
    revalidatePath("/profile");
    revalidatePath("/dashboard");
  }

  return result;
}
