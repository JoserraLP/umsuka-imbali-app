"use server";

import { revalidatePath } from "next/cache";
import {
  createInstrument,
  updateInstrument,
  toggleInstrumentActive,
  assignInstrument,
  unassignInstrument,
} from "@/lib/instruments/mutations";
import type { MutationResult } from "@/lib/instruments/mutations";
import type {
  CreateInstrumentInput,
  UpdateInstrumentInput,
  AssignInstrumentInput,
  UnassignInstrumentInput,
  ToggleInstrumentActiveInput,
} from "@/lib/instruments/schema";

export async function createInstrumentAction(
  input: CreateInstrumentInput,
): Promise<MutationResult> {
  const result = await createInstrument(input);

  if (result.success) {
    revalidatePath("/instruments");
  }

  return result;
}

export async function updateInstrumentAction(
  input: UpdateInstrumentInput,
): Promise<MutationResult> {
  const result = await updateInstrument(input);

  if (result.success) {
    revalidatePath("/instruments");
    revalidatePath(`/instruments/${input.id}`);
  }

  return result;
}

export async function toggleInstrumentActiveAction(
  input: ToggleInstrumentActiveInput,
): Promise<MutationResult> {
  const result = await toggleInstrumentActive(input);

  if (result.success) {
    revalidatePath("/instruments");
    revalidatePath(`/instruments/${input.instrument_id}`);
  }

  return result;
}

export async function assignInstrumentAction(
  input: AssignInstrumentInput,
): Promise<MutationResult> {
  const result = await assignInstrument(input);

  if (result.success) {
    revalidatePath("/instruments");
    revalidatePath(`/instruments/${input.instrument_id}`);
  }

  return result;
}

export async function unassignInstrumentAction(
  input: UnassignInstrumentInput,
): Promise<MutationResult> {
  const result = await unassignInstrument(input);

  if (result.success) {
    revalidatePath("/instruments");
    revalidatePath(`/instruments/${input.instrument_id}`);
  }

  return result;
}