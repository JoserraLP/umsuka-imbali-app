"use server";

import { revalidatePath } from "next/cache";
import {
  createShift,
  updateShift,
  deleteShift,
  assignMember,
  unassignMember,
} from "@/lib/shifts/mutations";
import type {
  CreateShiftInput,
  UpdateShiftInput,
  AssignMemberInput,
  UnassignMemberInput,
} from "@/lib/shifts/schema";
import type { MutationResult } from "@/lib/shifts/mutations";

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

export async function assignMemberAction(
  input: AssignMemberInput & { eventId: string },
): Promise<MutationResult> {
  const result = await assignMember({
    shiftId: input.shiftId,
    userId: input.userId,
  });

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}

export async function unassignMemberAction(
  input: UnassignMemberInput & { eventId: string },
): Promise<MutationResult> {
  const result = await unassignMember({
    assignmentId: input.assignmentId,
  });

  if (result.success) {
    revalidatePath(`/events/${input.eventId}`);
  }

  return result;
}
