import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import type { AuthenticatedProfile } from "@/types/auth";
import {
  createTransactionSchema,
  updateTransactionSchema,
  deleteTransactionSchema,
  type CreateTransactionInput,
  type UpdateTransactionInput,
  type DeleteTransactionInput,
} from "@/lib/finances/schema";

export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
}

// ── Authorization helper ──────────────────────────
async function requireManagementGuard(errorMessage: string): Promise<AuthenticatedProfile | MutationResult> {
  const actor = await requireAuthenticatedProfile();

  if (!isManagementRole(actor.role)) {
    return { success: false, error: errorMessage };
  }

  return actor;
}

function parseError(errors: { issues: { message: string }[] }): MutationResult {
  return {
    success: false,
    error: errors.issues.map((issue) => issue.message).join(", "),
  };
}

// ── Mutations ─────────────────────────────────────

const FINANCE_GUARD_MESSAGE = "Solo la directiva puede gestionar las finanzas.";

export async function createTransaction(input: CreateTransactionInput): Promise<MutationResult> {
  const parsed = createTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard(FINANCE_GUARD_MESSAGE);
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("transactions")
    .insert({
      type: parsed.data.type,
      category: parsed.data.category,
      amount: parsed.data.amount,
      description: parsed.data.description ?? null,
      transaction_date: parsed.data.transaction_date,
      created_by: authResult.id,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, id: data.id };
}

export async function updateTransaction(input: UpdateTransactionInput): Promise<MutationResult> {
  const parsed = updateTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard(FINANCE_GUARD_MESSAGE);
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const { data: existing, error: fetchError } = await supabase
    .from("transactions")
    .select("id")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (fetchError) {
    return { success: false, error: fetchError.message };
  }

  if (!existing) {
    return { success: false, error: "Transacción no encontrada." };
  }

  const { error } = await supabase
    .from("transactions")
    .update({
      type: parsed.data.type,
      category: parsed.data.category,
      amount: parsed.data.amount,
      description: parsed.data.description ?? null,
      transaction_date: parsed.data.transaction_date,
    })
    .eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function deleteTransaction(input: DeleteTransactionInput): Promise<MutationResult> {
  const parsed = deleteTransactionSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard(FINANCE_GUARD_MESSAGE);
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const { data: existing, error: fetchError } = await supabase
    .from("transactions")
    .select("id")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (fetchError) {
    return { success: false, error: fetchError.message };
  }

  if (!existing) {
    return { success: false, error: "Transacción no encontrada." };
  }

  const { error } = await supabase.from("transactions").delete().eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
