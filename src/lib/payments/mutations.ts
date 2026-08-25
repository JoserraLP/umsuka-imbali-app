import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import type { AuthenticatedProfile } from "@/types/auth";
import {
  registerPaymentSchema,
  updatePaymentSchema,
  deletePaymentSchema,
  bulkRegisterMonthlySchema,
  type RegisterPaymentInput,
  type UpdatePaymentInput,
  type DeletePaymentInput,
  type BulkRegisterMonthlyInput,
} from "@/lib/payments/schema";

export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
}

export interface BulkMutationResult {
  success: boolean;
  error?: string;
  created: number;
  skipped: number;
  errors: string[];
}

const PAYMENTS_GUARD_MESSAGE = "Solo la directiva puede gestionar los pagos.";

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

function isUniqueViolation(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("duplicate") || m.includes("uniq_member") || m.includes("unique") || m.includes("already exists");
}

// ── Mutations ─────────────────────────────────────

export async function registerPayment(input: RegisterPaymentInput): Promise<MutationResult> {
  const parsed = registerPaymentSchema.safeParse(input);
  if (!parsed.success) return parseError(parsed.error);

  const authResult = await requireManagementGuard(PAYMENTS_GUARD_MESSAGE);
  if (!("id" in authResult)) return authResult;

  const supabase = await createClient();

  // Verify user exists and is not deleted
  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, deleted_at")
    .eq("id", parsed.data.user_id)
    .maybeSingle();

  if (profileError) return { success: false, error: profileError.message };
  if (!profile) return { success: false, error: "Miembro no encontrado." };
  if (profile.deleted_at !== null) return { success: false, error: "El miembro no está disponible." };

  const { data, error } = await supabase
    .from("member_payments")
    .insert({
      user_id: parsed.data.user_id,
      payment_type: parsed.data.payment_type,
      period_month: parsed.data.period_month,
      period_year: parsed.data.period_year,
      amount: parsed.data.amount,
      paid_at: parsed.data.paid_at,
      registered_by: authResult.id,
      notes: parsed.data.notes ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if (isUniqueViolation(error.message)) {
      return { success: false, error: "Ya existe un pago para ese miembro en el mismo periodo." };
    }
    return { success: false, error: error.message };
  }

  return { success: true, id: data.id };
}

export async function updatePayment(input: UpdatePaymentInput): Promise<MutationResult> {
  const parsed = updatePaymentSchema.safeParse(input);
  if (!parsed.success) return parseError(parsed.error);

  const authResult = await requireManagementGuard(PAYMENTS_GUARD_MESSAGE);
  if (!("id" in authResult)) return authResult;

  const supabase = await createClient();

  const { data: existing, error: fetchError } = await supabase
    .from("member_payments")
    .select("id")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (fetchError) return { success: false, error: fetchError.message };
  if (!existing) return { success: false, error: "Pago no encontrado." };

  const { error } = await supabase
    .from("member_payments")
    .update({
      user_id: parsed.data.user_id,
      payment_type: parsed.data.payment_type,
      period_month: parsed.data.period_month,
      period_year: parsed.data.period_year,
      amount: parsed.data.amount,
      paid_at: parsed.data.paid_at,
      notes: parsed.data.notes ?? null,
    })
    .eq("id", parsed.data.id);

  if (error) {
    if (isUniqueViolation(error.message)) {
      return { success: false, error: "Ya existe un pago para ese miembro en el mismo periodo." };
    }
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function deletePayment(input: DeletePaymentInput): Promise<MutationResult> {
  const parsed = deletePaymentSchema.safeParse(input);
  if (!parsed.success) return parseError(parsed.error);

  const authResult = await requireManagementGuard(PAYMENTS_GUARD_MESSAGE);
  if (!("id" in authResult)) return authResult;

  const supabase = await createClient();

  const { data: existing, error: fetchError } = await supabase
    .from("member_payments")
    .select("id")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (fetchError) return { success: false, error: fetchError.message };
  if (!existing) return { success: false, error: "Pago no encontrado." };

  const { error } = await supabase.from("member_payments").delete().eq("id", parsed.data.id);

  if (error) return { success: false, error: error.message };

  return { success: true };
}

export async function bulkRegisterMonthly(input: BulkRegisterMonthlyInput): Promise<BulkMutationResult> {
  const parsed = bulkRegisterMonthlySchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      created: 0,
      skipped: 0,
      errors: parsed.error.issues.map((i) => i.message),
      error: parsed.error.issues.map((i) => i.message).join(", "),
    };
  }

  const authResult = await requireManagementGuard(PAYMENTS_GUARD_MESSAGE);
  if (!("id" in authResult)) {
    return { success: false, created: 0, skipped: 0, errors: [authResult.error ?? "No autorizado"], error: authResult.error };
  }

  const supabase = await createClient();

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const userId of parsed.data.user_ids) {
    const { error } = await supabase
      .from("member_payments")
      .insert({
        user_id: userId,
        payment_type: "monthly" as const,
        period_month: parsed.data.period_month,
        period_year: parsed.data.period_year,
        amount: parsed.data.amount,
        paid_at: parsed.data.paid_at,
        registered_by: authResult.id,
        notes: parsed.data.notes ?? null,
      })
      .select("id")
      .single();

    if (error) {
      if (isUniqueViolation(error.message)) {
        skipped += 1;
      } else {
        errors.push(`${userId}: ${error.message}`);
      }
    } else {
      created += 1;
    }
  }

  const success = errors.length === 0;
  return {
    success,
    created,
    skipped,
    errors,
    error: errors.length > 0 ? errors.join("; ") : undefined,
  };
}
