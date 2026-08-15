"use server";

import { revalidatePath } from "next/cache";
import {
  joinWaitlist,
  leaveWaitlist,
  setWaitlistEntryStatus,
  removeWaitlistEntry,
} from "@/lib/events/mutations";
import type { MutationResult } from "@/lib/events/mutations";
import type {
  JoinWaitlistInput,
  LeaveWaitlistInput,
  SetWaitlistEntryStatusInput,
  RemoveWaitlistEntryInput,
} from "@/lib/events/schema";

export async function joinWaitlistAction(input: JoinWaitlistInput): Promise<MutationResult> {
  const result = await joinWaitlist(input);

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}

export async function leaveWaitlistAction(input: LeaveWaitlistInput): Promise<MutationResult> {
  const result = await leaveWaitlist(input);

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}

export async function setWaitlistEntryStatusAction(
  input: SetWaitlistEntryStatusInput,
): Promise<MutationResult> {
  const result = await setWaitlistEntryStatus(input);

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}

export async function removeWaitlistEntryAction(
  input: RemoveWaitlistEntryInput,
): Promise<MutationResult> {
  const result = await removeWaitlistEntry(input);

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}
