"use server";

import { revalidatePath } from "next/cache";
import { createEvent, updateEvent, deleteEvent } from "@/lib/events/mutations";
import type { CreateEventInput, UpdateEventInput, DeleteEventInput } from "@/lib/events/schema";
import type { MutationResult } from "@/lib/events/mutations";

export async function createEventAction(input: CreateEventInput): Promise<MutationResult> {
  const result = await createEvent(input);

  if (result.success) {
    revalidatePath("/events");
    revalidatePath("/calendar");
  }

  return result;
}

export async function updateEventAction(input: UpdateEventInput): Promise<MutationResult> {
  const result = await updateEvent(input);

  if (result.success) {
    revalidatePath("/events");
    revalidatePath(`/events/${input.id}`);
    revalidatePath("/calendar");
  }

  return result;
}

export async function deleteEventAction(input: DeleteEventInput): Promise<MutationResult> {
  const result = await deleteEvent(input);

  if (result.success) {
    revalidatePath("/events");
    revalidatePath("/calendar");
  }

  return result;
}
