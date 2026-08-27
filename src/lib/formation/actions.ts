"use server";

import { revalidatePath } from "next/cache";
import {
  createFormation,
  deleteFormation,
  assignDancerToSeat,
  removeDancerFromSeat,
  moveDancer,
  assignInstrumentToMusician,
  unassignInstrument,
  duplicateFormation,
} from "@/lib/formation/mutations";
import type {
  CreateFormationInput,
  DeleteFormationInput,
  AssignDancerInput,
  RemoveDancerInput,
  MoveDancerInput,
  AssignInstrumentInput,
  UnassignInstrumentInput,
} from "@/lib/formation/schema";
import type { MutationResult } from "@/lib/formation/mutations";

export async function createFormationAction(input: CreateFormationInput): Promise<MutationResult> {
  const result = await createFormation(input);
  if (result.success) {
    revalidatePath("/formation");
    revalidatePath("/events");
    if (result.id) revalidatePath(`/formation/${result.id}`);
  }
  return result;
}

export async function assignDancerAction(input: AssignDancerInput): Promise<MutationResult> {
  const result = await assignDancerToSeat(input);
  if (result.success) {
    revalidatePath("/formation");
    revalidatePath(`/formation/${input.formationId}`);
    revalidatePath("/events");
  }
  return result;
}

export async function removeDancerAction(input: RemoveDancerInput): Promise<MutationResult> {
  const result = await removeDancerFromSeat(input);
  if (result.success) {
    revalidatePath("/formation");
    revalidatePath(`/formation/${input.formationId}`);
    revalidatePath("/events");
  }
  return result;
}

export async function moveDancerAction(input: MoveDancerInput): Promise<MutationResult> {
  const result = await moveDancer(input);
  if (result.success) {
    revalidatePath("/formation");
    revalidatePath(`/formation/${input.formationId}`);
    revalidatePath("/events");
  }
  return result;
}

export async function assignInstrumentAction(input: AssignInstrumentInput): Promise<MutationResult> {
  const result = await assignInstrumentToMusician(input);
  if (result.success) {
    revalidatePath("/formation");
    if (input.formationId) revalidatePath(`/formation/${input.formationId}`);
    revalidatePath("/events");
  }
  return result;
}

export async function unassignInstrumentAction(input: UnassignInstrumentInput): Promise<MutationResult> {
  const result = await unassignInstrument(input);
  if (result.success) {
    revalidatePath("/formation");
    if (input.formationId) revalidatePath(`/formation/${input.formationId}`);
    revalidatePath("/events");
  }
  return result;
}

export async function duplicateFormationAction(formationId: string): Promise<MutationResult> {
  const result = await duplicateFormation(formationId);
  if (result.success) {
    revalidatePath("/formation");
    revalidatePath("/events");
  }
  return result;
}

export async function deleteFormationAction(input: DeleteFormationInput): Promise<MutationResult> {
  const result = await deleteFormation(input);
  if (result.success) {
    revalidatePath("/formation");
    revalidatePath("/events");
    revalidatePath(`/formation/${input.formationId}`);
  }
  return result;
}
