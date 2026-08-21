"use server";

import { revalidatePath } from "next/cache";
import {
  markRehearsalAttendance,
  markMultipleRehearsalAttendance,
  clearRehearsalSession,
  type RehearsalMutationResult,
} from "@/lib/rehearsals/mutations";
import type {
  MarkRehearsalAttendanceInput,
  MarkMultipleRehearsalAttendanceInput,
  ClearRehearsalSessionInput,
} from "@/lib/rehearsals/schema";

function revalidateRehearsal(eventId: string): void {
  // The event detail page and the member profile (participation tile)
  // both render rehearsal data.
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/profile");
}

export async function markRehearsalAttendanceAction(
  input: MarkRehearsalAttendanceInput,
): Promise<RehearsalMutationResult> {
  const result = await markRehearsalAttendance(input);

  if (result.success) {
    revalidateRehearsal(input.eventId);
  }

  return result;
}

export async function markMultipleRehearsalAttendanceAction(
  input: MarkMultipleRehearsalAttendanceInput,
): Promise<RehearsalMutationResult> {
  const result = await markMultipleRehearsalAttendance(input);

  if (result.success) {
    // Batch ops must target a single event (validated in the mutation).
    const eventId = input.records[0]?.eventId;
    if (eventId) {
      revalidateRehearsal(eventId);
    }
  }

  return result;
}

export async function clearRehearsalSessionAction(
  input: ClearRehearsalSessionInput,
): Promise<RehearsalMutationResult> {
  const result = await clearRehearsalSession(input);

  if (result.success) {
    revalidateRehearsal(input.eventId);
  }

  return result;
}
