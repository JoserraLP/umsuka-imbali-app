"use server";

import { revalidatePath } from "next/cache";
import { preRegisterMember, linkGmailToProfile, linkByInviteToken } from "@/lib/members/pre-register";
import type { PreRegisterMemberInput, LinkGmailInput } from "@/lib/members/pre-register-schema";

export async function preRegisterMemberAction(input: PreRegisterMemberInput) {
  const result = await preRegisterMember(input);
  if (result.success) {
    revalidatePath("/admin/members");
    revalidatePath("/members");
    revalidatePath("/profile");
  }
  return result;
}

export async function linkGmailAction(input: LinkGmailInput) {
  const result = await linkGmailToProfile(input);
  if (result.success) {
    revalidatePath("/admin/members");
    revalidatePath("/members");
    revalidatePath("/profile");
  }
  return result;
}

export async function linkByInviteTokenAction(token: string, gmail: string) {
  const result = await linkByInviteToken(token, gmail);
  if (result.success) {
    revalidatePath("/admin/members");
    revalidatePath("/members");
  }
  return result;
}
