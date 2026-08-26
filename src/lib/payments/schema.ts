import { z } from "zod";

// ── Constants ─────────────────────────────────────
export const PAYMENT_TYPES = ["monthly", "yearly"] as const;
export type PaymentType = (typeof PAYMENT_TYPES)[number];

export const PAYMENT_TYPE_LABELS: Record<PaymentType, string> = {
  monthly: "Mensual",
  yearly: "Anual",
};

export const MONTH_NAMES: Record<number, string> = {
  1: "Enero",
  2: "Febrero",
  3: "Marzo",
  4: "Abril",
  5: "Mayo",
  6: "Junio",
  7: "Julio",
  8: "Agosto",
  9: "Septiembre",
  10: "Octubre",
  11: "Noviembre",
  12: "Diciembre",
};

// ── Helpers ───────────────────────────────────────
const optionalTrimmedText = (maxLength: number, message: string) =>
  z
    .string()
    .trim()
    .max(maxLength, message)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// ── Base fields ───────────────────────────────────
const basePaymentFields = {
  user_id: z.string().uuid("user_id debe ser un UUID válido."),
  payment_type: z.enum(PAYMENT_TYPES, {
    message: "El tipo de pago debe ser mensual o anual.",
  }),
  period_month: z
    .union([z.number(), z.nan(), z.null()])
    .optional()
    .transform((value) => {
      if (value === null || value === undefined) return null;
      if (typeof value === "number" && Number.isNaN(value)) return null;
      return value as number | null;
    }),
  period_year: z.coerce
    .number({ message: "El año debe ser un número." })
    .int("El año debe ser un entero.")
    .min(1, "El año debe ser >= 1.")
    .max(9999, "El año debe ser <= 9999."),
  amount: z.coerce
    .number({ message: "El importe debe ser un número." })
    .positive("El importe debe ser mayor que 0.")
    .max(99999999.99, "El importe máximo es 99.999.999,99.")
    .refine((value) => Math.round(value * 100) / 100 === value, {
      message: "El importe debe tener como máximo 2 decimales.",
    }),
  paid_at: z
    .string()
    .trim()
    .min(1, "La fecha de pago es obligatoria.")
    .refine(isValidDateString, "La fecha debe tener formato YYYY-MM-DD válido."),
  notes: optionalTrimmedText(2000, "Las notas deben tener 2000 caracteres o menos."),
};

// Cross-field: monthly requires 1-12, yearly requires null
function paymentMonthCoherence(data: { payment_type: PaymentType; period_month: number | null }): boolean {
  if (data.payment_type === "monthly") {
    return data.period_month !== null && data.period_month >= 1 && data.period_month <= 12;
  }
  return data.period_month === null;
}

// ── Register (create) ─────────────────────────────
export const registerPaymentSchema = z
  .object(basePaymentFields)
  .refine(paymentMonthCoherence, {
    message: "Para pago mensual el mes debe ser 1-12; para anual debe dejarse vacío.",
    path: ["period_month"],
  });

export type RegisterPaymentInput = z.infer<typeof registerPaymentSchema>;

// ── Update ────────────────────────────────────────
export const updatePaymentSchema = z
  .object({
    id: z.string().uuid("id debe ser un UUID válido."),
    ...basePaymentFields,
  })
  .refine(paymentMonthCoherence, {
    message: "Para pago mensual el mes debe ser 1-12; para anual debe dejarse vacío.",
    path: ["period_month"],
  });

export type UpdatePaymentInput = z.infer<typeof updatePaymentSchema>;

// ── Delete ────────────────────────────────────────
export const deletePaymentSchema = z.object({
  id: z.string().uuid("id debe ser un UUID válido."),
});

export type DeletePaymentInput = z.infer<typeof deletePaymentSchema>;

// ── Bulk register ─────────────────────────────────
export const bulkRegisterMonthlySchema = z
  .object({
    user_ids: z.array(z.string().uuid("user_id debe ser un UUID válido.")).min(1, "Debe seleccionar al menos un miembro."),
    period_month: z.number().int("El mes debe ser un entero.").min(1, "El mes debe ser entre 1 y 12.").max(12, "El mes debe ser entre 1 y 12."),
    period_year: z.number().int("El año debe ser un entero.").min(1, "El año debe ser >= 1.").max(9999, "El año debe ser <= 9999."),
    amount: z.coerce
      .number({ message: "El importe debe ser un número." })
      .positive("El importe debe ser mayor que 0.")
      .max(99999999.99, "El importe máximo es 99.999.999,99.")
      .refine((value) => Math.round(value * 100) / 100 === value, {
        message: "El importe debe tener como máximo 2 decimales.",
      }),
    paid_at: z
      .string()
      .trim()
      .min(1, "La fecha de pago es obligatoria.")
      .refine(isValidDateString, "La fecha debe tener formato YYYY-MM-DD válido."),
    notes: optionalTrimmedText(2000, "Las notas deben tener 2000 caracteres o menos."),
  });

export type BulkRegisterMonthlyInput = z.infer<typeof bulkRegisterMonthlySchema>;

// ── Helpers ───────────────────────────────────────
export function isPaymentType(value: string): value is PaymentType {
  return (PAYMENT_TYPES as readonly string[]).includes(value);
}

export function formatPaymentPeriod(payment: { payment_type: PaymentType; period_month: number | null; period_year: number }): string {
  if (payment.payment_type === "yearly") {
    return `Año ${payment.period_year}`;
  }
  const monthName = MONTH_NAMES[payment.period_month ?? 1] ?? `Mes ${payment.period_month}`;
  return `${monthName} ${payment.period_year}`;
}
