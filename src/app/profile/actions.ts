"use server";

import { revalidatePath } from "next/cache";
import { updateOwnProfile } from "@/lib/profiles/mutations";
import type { UpdateOwnProfileInput } from "@/lib/profiles/schema";
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
