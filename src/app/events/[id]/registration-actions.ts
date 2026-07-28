"use server";

import { revalidatePath } from "next/cache";
import { registerForEvent, unregisterFromEvent } from "@/lib/registrations/mutations";
import type { RegisterForEventInput, UnregisterFromEventInput } from "@/lib/registrations/schema";
import type { MutationResult } from "@/lib/registrations/mutations";

export async function registerForEventAction(input: RegisterForEventInput): Promise<MutationResult> {
  const result = await registerForEvent(input);

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}

export async function unregisterFromEventAction(
  input: UnregisterFromEventInput,
): Promise<MutationResult> {
  const result = await unregisterFromEvent(input);

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}
