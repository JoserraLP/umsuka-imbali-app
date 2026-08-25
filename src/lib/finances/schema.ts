import { z } from "zod";

// ── Constants ─────────────────────────────────────
export const TRANSACTION_TYPES = ["income", "expense"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const TRANSACTION_CATEGORIES = [
  "bar_shift",
  "bar_purchases",
  "costume_materials",
  "dance_materials",
  "other",
] as const;
export type TransactionCategory = (typeof TRANSACTION_CATEGORIES)[number];

export const TRANSACTION_TYPE_LABELS: Record<TransactionType, string> = {
  income: "Ingreso",
  expense: "Gasto",
};

export const TRANSACTION_CATEGORY_LABELS: Record<TransactionCategory, string> = {
  bar_shift: "Turno de barra",
  bar_purchases: "Compras de barra",
  costume_materials: "Material del traje",
  dance_materials: "Material para baile",
  other: "Otros",
};

// ── Helpers ───────────────────────────────────────
const optionalTrimmedText = (maxLength: number, message: string) =>
  z
    .string()
    .trim()
    .max(maxLength, message)
    .transform((value) => (value === "" ? null : value))
    .optional();

function isValidDateString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const d = new Date(value);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

// ── Create / Update ───────────────────────────────
export const createTransactionSchema = z.object({
  type: z.enum(TRANSACTION_TYPES, {
    message: "El tipo debe ser income o expense.",
  }),
  category: z.enum(TRANSACTION_CATEGORIES, {
    message: "La categoría no es válida.",
  }),
  amount: z.coerce
    .number({
      message: "El importe debe ser un número.",
    })
    .positive("El importe debe ser mayor que 0.")
    .max(99999999.99, "El importe máximo es 99.999.999,99.")
    .refine((value) => Math.round(value * 100) / 100 === value, {
      message: "El importe debe tener como máximo 2 decimales.",
    }),
  description: optionalTrimmedText(2000, "La descripción debe tener 2000 caracteres o menos."),
  transaction_date: z
    .string()
    .trim()
    .min(1, "La fecha es obligatoria.")
    .refine(isValidDateString, "La fecha debe tener formato YYYY-MM-DD válido."),
});

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;

export const updateTransactionSchema = createTransactionSchema.extend({
  id: z.string().uuid("id debe ser un UUID válido."),
});

export type UpdateTransactionInput = z.infer<typeof updateTransactionSchema>;

// ── Delete ────────────────────────────────────────
export const deleteTransactionSchema = z.object({
  id: z.string().uuid("id debe ser un UUID válido."),
});

export type DeleteTransactionInput = z.infer<typeof deleteTransactionSchema>;

// ── Filters ───────────────────────────────────────
export const filterSchema = z
  .object({
    type: z.enum(TRANSACTION_TYPES).optional(),
    category: z.enum(TRANSACTION_CATEGORIES).optional(),
    from: z
      .string()
      .trim()
      .optional()
      .refine((value) => !value || isValidDateString(value), "from debe ser YYYY-MM-DD válido."),
    to: z
      .string()
      .trim()
      .optional()
      .refine((value) => !value || isValidDateString(value), "to debe ser YYYY-MM-DD válido."),
  })
  .refine((value) => !value.from || !value.to || value.from <= value.to, {
    message: "El rango de fechas no es válido: from debe ser <= to.",
    path: ["from"],
  });

export type TransactionFilters = z.infer<typeof filterSchema>;

// ── Helpers ───────────────────────────────────────
export function isTransactionType(value: string): value is TransactionType {
  return (TRANSACTION_TYPES as readonly string[]).includes(value);
}

export function isTransactionCategory(value: string): value is TransactionCategory {
  return (TRANSACTION_CATEGORIES as readonly string[]).includes(value);
}
