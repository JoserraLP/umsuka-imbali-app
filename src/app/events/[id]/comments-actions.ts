"use server";

import { revalidatePath } from "next/cache";
import { addEventComment, deleteEventComment } from "@/lib/events/mutations";
import type { MutationResult } from "@/lib/events/mutations";
import type { AddEventCommentInput, DeleteEventCommentInput } from "@/lib/events/schema";

export async function addEventCommentAction(input: AddEventCommentInput): Promise<MutationResult> {
  const result = await addEventComment(input);

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}

export async function deleteEventCommentAction(
  input: DeleteEventCommentInput,
): Promise<MutationResult> {
  const result = await deleteEventComment(input);

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}
