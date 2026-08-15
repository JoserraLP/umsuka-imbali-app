"use server";

import { revalidatePath } from "next/cache";
import {
  registerForEvent,
  unregisterFromEvent,
  type MutationResult,
  type RegisterForEventResult,
} from "@/lib/registrations/mutations";
import type { RegisterForEventInput, UnregisterFromEventInput } from "@/lib/registrations/schema";

export async function registerForEventAction(
  input: RegisterForEventInput,
): Promise<RegisterForEventResult> {
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
