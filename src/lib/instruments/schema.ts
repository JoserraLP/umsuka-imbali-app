import { z } from "zod";

// ── Shared field shapes ────────────────────────────────
// Optional free-text fields are trimmed and normalized to null when
// empty (mirrors the events module normalization pattern).

const optionalTrimmedText = (maxLength: number, message: string) =>
  z
    .string()
    .trim()
    .max(maxLength, message)
    .nullable()
    .optional()
    .transform((value) => (value === "" ? null : value));

// ── Instrument create / update ─────────────────────────

export const createInstrumentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio.")
    .max(200, "El nombre debe tener 200 caracteres o menos."),
  category: optionalTrimmedText(
    100,
    "La categoría debe tener 100 caracteres o menos.",
  ),
  description: optionalTrimmedText(
    2000,
    "La descripción debe tener 2000 caracteres o menos.",
  ),
});
export type CreateInstrumentInput = z.infer<typeof createInstrumentSchema>;

export const updateInstrumentSchema = createInstrumentSchema.extend({
  id: z.string().uuid("id debe ser un UUID válido."),
});
export type UpdateInstrumentInput = z.infer<typeof updateInstrumentSchema>;

// ── Assignment actions ─────────────────────────────────

export const assignSchema = z.object({
  instrument_id: z.string().uuid("instrument_id debe ser un UUID válido."),
  user_id: z.string().uuid("user_id debe ser un UUID válido."),
});
export type AssignInstrumentInput = z.infer<typeof assignSchema>;

export const unassignSchema = z.object({
  instrument_id: z.string().uuid("instrument_id debe ser un UUID válido."),
});
export type UnassignInstrumentInput = z.infer<typeof unassignSchema>;

export const toggleInstrumentActiveSchema = z.object({
  instrument_id: z.string().uuid("instrument_id debe ser un UUID válido."),
});
export type ToggleInstrumentActiveInput = z.infer<
  typeof toggleInstrumentActiveSchema
>;