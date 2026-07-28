"use server";

import { revalidatePath } from "next/cache";
import { requestAbsence, justifyAbsence, deleteAbsence } from "@/lib/absences/mutations";
import type {
  RequestAbsenceInput,
  JustifyAbsenceInput,
  DeleteAbsenceInput,
} from "@/lib/absences/schema";
import type { MutationResult } from "@/lib/absences/mutations";

export async function requestAbsenceAction(input: RequestAbsenceInput): Promise<MutationResult> {
  const result = await requestAbsence(input);

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}

export async function justifyAbsenceAction(input: JustifyAbsenceInput): Promise<MutationResult> {
  const result = await justifyAbsence(input);

  if (result.success) {
    revalidatePath("/events/[id]", "page");
  }

  return result;
}

export async function deleteAbsenceAction(input: DeleteAbsenceInput): Promise<MutationResult> {
  const result = await deleteAbsence(input);

  if (result.success) {
    revalidatePath("/events/[id]", "page");
  }

  return result;
}
