"use server";

import { revalidatePath } from "next/cache";
import {
  createTransaction,
  updateTransaction,
  deleteTransaction,
  type MutationResult,
} from "@/lib/finances/mutations";
import type {
  CreateTransactionInput,
  UpdateTransactionInput,
  DeleteTransactionInput,
} from "@/lib/finances/schema";

export async function createTransactionAction(input: CreateTransactionInput): Promise<MutationResult> {
  const result = await createTransaction(input);
  if (result.success) {
    revalidatePath("/finances");
  }
  return result;
}

export async function updateTransactionAction(input: UpdateTransactionInput): Promise<MutationResult> {
  const result = await updateTransaction(input);
  if (result.success) {
    revalidatePath("/finances");
  }
  return result;
}

export async function deleteTransactionAction(input: DeleteTransactionInput): Promise<MutationResult> {
  const result = await deleteTransaction(input);
  if (result.success) {
    revalidatePath("/finances");
  }
  return result;
}
