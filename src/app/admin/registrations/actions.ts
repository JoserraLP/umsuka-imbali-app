"use server";

import { revalidatePath } from "next/cache";
import { approveUser, suspendUser } from "@/lib/approvals/mutations";
import type { ApproveUserInput, SuspendUserInput } from "@/lib/approvals/schema";
import type { MutationResult } from "@/lib/approvals/mutations";

export async function approveUserAction(input: ApproveUserInput): Promise<MutationResult> {
  const result = await approveUser(input);

  if (result.success) {
    revalidatePath("/admin/registrations");
    revalidatePath("/admin/users");
  }

  return result;
}

export async function suspendUserAction(input: SuspendUserInput): Promise<MutationResult> {
  const result = await suspendUser(input);

  if (result.success) {
    revalidatePath("/admin/registrations");
    revalidatePath("/admin/users");
  }

  return result;
}
