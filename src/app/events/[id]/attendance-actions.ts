"use server";

import { revalidatePath } from "next/cache";
import {
  markAttendance,
  markMultipleAttendance,
  updateAttendance,
  deleteAttendance,
} from "@/lib/attendance/mutations";
import type {
  MarkAttendanceInput,
  MarkMultipleAttendanceInput,
  UpdateAttendanceInput,
  DeleteAttendanceInput,
} from "@/lib/attendance/schema";
import type { MutationResult } from "@/lib/attendance/mutations";

export async function markAttendanceAction(input: MarkAttendanceInput): Promise<MutationResult> {
  const result = await markAttendance(input);

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}

export async function markMultipleAttendanceAction(
  input: MarkMultipleAttendanceInput,
): Promise<MutationResult> {
  const result = await markMultipleAttendance(input);

  if (result.success) {
    // Revalidate the first event's path; for batch ops all records
    // should belong to the same event.
    const eventId = input.records[0]?.eventId;
    if (eventId) {
      revalidatePath(`/events/${eventId}`);
    }
  }

  return result;
}

export async function updateAttendanceAction(input: UpdateAttendanceInput): Promise<MutationResult> {
  const result = await updateAttendance(input);

  if (result.success) {
    // The caller must provide the eventId for revalidation via the
    // updated attendance record — we revalidate broadly.
    revalidatePath("/events/[id]", "page");
  }

  return result;
}

export async function deleteAttendanceAction(input: DeleteAttendanceInput): Promise<MutationResult> {
  const result = await deleteAttendance(input);

  if (result.success) {
    revalidatePath("/events/[id]", "page");
  }

  return result;
}
