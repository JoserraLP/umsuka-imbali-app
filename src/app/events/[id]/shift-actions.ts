"use server";

import { revalidatePath } from "next/cache";
import {
  createShift,
  updateShift,
  deleteShift,
} from "@/lib/shifts/mutations";
import {
  assignMemberToShift,
  unassignMemberFromShift,
} from "@/lib/shifts/assignments";
import type {
  CreateShiftInput,
  UpdateShiftInput,
} from "@/lib/shifts/schema";
import type { MutationResult } from "@/lib/shifts/mutations";
import type { AssignmentResult } from "@/lib/shifts/assignments";

export async function createShiftAction(
  input: CreateShiftInput,
): Promise<MutationResult> {
  const result = await createShift(input);

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}

export async function updateShiftAction(
  input: UpdateShiftInput,
): Promise<MutationResult> {
  const result = await updateShift(input);

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}

export async function deleteShiftAction(
  shiftId: string,
  eventId: string,
): Promise<MutationResult> {
  const result = await deleteShift({ id: shiftId });

  if (result.success) {
    revalidatePath(`/events/${eventId}`);
  }

  return result;
}

export async function assignMemberToShiftAction(
  input: { shiftId: string; userId: string } & { eventId: string },
): Promise<AssignmentResult> {
  const result = await assignMemberToShift({
    shiftId: input.shiftId,
    userId: input.userId,
  });

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}

export async function unassignMemberFromShiftAction(
  input: { assignmentId: string } & { eventId: string },
): Promise<AssignmentResult> {
  const result = await unassignMemberFromShift({
    assignmentId: input.assignmentId,
  });

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}
