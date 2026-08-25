"use server";

import { revalidatePath } from "next/cache";
import {
  registerPayment,
  updatePayment,
  deletePayment,
  bulkRegisterMonthly,
  type MutationResult,
  type BulkMutationResult,
} from "@/lib/payments/mutations";
import type {
  RegisterPaymentInput,
  UpdatePaymentInput,
  DeletePaymentInput,
  BulkRegisterMonthlyInput,
} from "@/lib/payments/schema";

export async function registerPaymentAction(input: RegisterPaymentInput): Promise<MutationResult> {
  const result = await registerPayment(input);
  if (result.success) {
    revalidatePath("/payments");
    revalidatePath("/profile");
    revalidatePath("/events");
  }
  return result;
}

export async function updatePaymentAction(input: UpdatePaymentInput): Promise<MutationResult> {
  const result = await updatePayment(input);
  if (result.success) {
    revalidatePath("/payments");
    revalidatePath("/profile");
    revalidatePath("/events");
  }
  return result;
}

export async function deletePaymentAction(input: DeletePaymentInput): Promise<MutationResult> {
  const result = await deletePayment(input);
  if (result.success) {
    revalidatePath("/payments");
    revalidatePath("/profile");
    revalidatePath("/events");
  }
  return result;
}

export async function bulkRegisterMonthlyAction(input: BulkRegisterMonthlyInput): Promise<BulkMutationResult> {
  const result = await bulkRegisterMonthly(input);
  if (result.created > 0) {
    revalidatePath("/payments");
    revalidatePath("/profile");
    revalidatePath("/events");
  }
  return result;
}
