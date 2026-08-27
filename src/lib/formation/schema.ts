import { z } from "zod";

// ── Constants ─────────────────────────────────────────

export const MAX_SEATS_PER_ROW = 6 as const;
export const SEAT_NUMBERS = [1, 2, 3, 4, 5, 6] as const;
export type SeatNumber = (typeof SEAT_NUMBERS)[number];

export function isValidSeat(seat: number): seat is SeatNumber {
  return Number.isInteger(seat) && seat >= 1 && seat <= MAX_SEATS_PER_ROW;
}

export const FORMATION_TYPES = ["dance", "music"] as const;
export type FormationType = (typeof FORMATION_TYPES)[number];

export const FORMATION_TYPE_LABELS: Record<FormationType, string> = {
  dance: "Baile",
  music: "Música",
};

export function isFormationType(v: string): v is FormationType {
  return (FORMATION_TYPES as readonly string[]).includes(v);
}

// ── Helpers ───────────────────────────────────────────

const uuidMessage = (field: string) => `${field} debe ser un UUID válido.`;

const requiredTrimmedString = (field: string, min = 1, max = 200) =>
  z
    .string()
    .trim()
    .min(min, `${field} es obligatorio.`)
    .max(max, `${field} debe tener ${max} caracteres o menos.`);

// ── Formation ─────────────────────────────────────────

export const createFormationSchema = z.object({
  name: requiredTrimmedString("El nombre", 1, 200),
  eventId: z
    .string()
    .uuid(uuidMessage("El evento"))
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v ?? null)),
  formationType: z.enum(FORMATION_TYPES, {
    errorMap: () => ({ message: "El tipo de formación es obligatorio (baile o música)." }),
  }),
});

export type CreateFormationInput = z.infer<typeof createFormationSchema>;

export const deleteFormationSchema = z.object({
  formationId: z.string().uuid(uuidMessage("La formación")),
});

export type DeleteFormationInput = z.infer<typeof deleteFormationSchema>;

// ── Dancer assignment ─────────────────────────────────

export const assignDancerSchema = z.object({
  formationId: z.string().uuid(uuidMessage("La formación")),
  rowNumber: z
    .number()
    .int("La fila debe ser un número entero.")
    .min(1, "La fila debe ser mayor o igual a 1."),
  seatNumber: z
    .number()
    .int("El asiento debe ser un número entero.")
    .min(1, "El asiento debe estar entre 1 y 6.")
    .max(6, "El asiento debe estar entre 1 y 6."),
  memberId: z.string().uuid(uuidMessage("La bailarina")),
});

export type AssignDancerInput = z.infer<typeof assignDancerSchema>;

export const removeDancerSchema = z.object({
  formationId: z.string().uuid(uuidMessage("La formación")),
  rowNumber: z.number().int().min(1, "La fila debe ser mayor o igual a 1."),
  seatNumber: z.number().int().min(1).max(6),
});

export type RemoveDancerInput = z.infer<typeof removeDancerSchema>;

export const moveDancerSchema = z.object({
  formationId: z.string().uuid(uuidMessage("La formación")),
  fromRowNumber: z.number().int().min(1, "La fila origen debe ser mayor o igual a 1."),
  fromSeatNumber: z.number().int().min(1).max(6),
  toRowNumber: z.number().int().min(1, "La fila destino debe ser mayor o igual a 1."),
  toSeatNumber: z.number().int().min(1).max(6),
});

export type MoveDancerInput = z.infer<typeof moveDancerSchema>;

// ── Instrument assignment ───────────────────────────────

export const assignInstrumentSchema = z.object({
  userId: z.string().uuid(uuidMessage("El músico")),
  instrumentId: z.string().uuid(uuidMessage("El instrumento")),
  formationId: z
    .string()
    .uuid(uuidMessage("La formación"))
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v ?? null)),
});

export type AssignInstrumentInput = z.infer<typeof assignInstrumentSchema>;

export const unassignInstrumentSchema = z.object({
  userId: z.string().uuid(uuidMessage("El músico")),
  formationId: z
    .string()
    .uuid(uuidMessage("La formación"))
    .nullable()
    .optional()
    .transform((v) => (v === "" ? null : v ?? null)),
});

export type UnassignInstrumentInput = z.infer<typeof unassignInstrumentSchema>;
