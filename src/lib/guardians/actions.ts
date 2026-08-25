"use server";

import { revalidatePath } from "next/cache";
import {
  createGuardian,
  updateGuardian,
  assignGuardian,
  unassignGuardian,
  setMinorStatus,
  type MutationResult,
} from "@/lib/guardians/mutations";
import type {
  CreateGuardianInput,
  UpdateGuardianInput,
  AssignGuardianInput,
  UnassignGuardianInput,
  SetMinorStatusInput,
} from "@/lib/guardians/schema";

function revalidateAll() {
  revalidatePath("/guardians");
  revalidatePath("/admin/users");
  revalidatePath("/members");
  revalidatePath("/profile");
}

export async function createGuardianAction(input: CreateGuardianInput): Promise<MutationResult> {
  const result = await createGuardian(input);
  if (result.success) revalidateAll();
  return result;
}

export async function updateGuardianAction(input: UpdateGuardianInput): Promise<MutationResult> {
  const result = await updateGuardian(input);
  if (result.success) revalidateAll();
  return result;
}

export async function assignGuardianAction(input: AssignGuardianInput): Promise<MutationResult> {
  const result = await assignGuardian(input);
  if (result.success) revalidateAll();
  return result;
}

export async function unassignGuardianAction(input: UnassignGuardianInput): Promise<MutationResult> {
  const result = await unassignGuardian(input);
  if (result.success) revalidateAll();
  return result;
}

export async function setMinorStatusAction(input: SetMinorStatusInput): Promise<MutationResult> {
  const result = await setMinorStatus(input);
  if (result.success) revalidateAll();
  return result;
}
