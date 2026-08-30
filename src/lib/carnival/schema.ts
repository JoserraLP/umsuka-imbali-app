import { z } from "zod";

export const CARNIVAL_YEAR_STATUSES = ["active", "archived"] as const;
export type CarnivalYearStatus = (typeof CARNIVAL_YEAR_STATUSES)[number];

export const createCarnivalYearSchema = z.object({
  year: z.coerce
    .number({ message: "El año debe ser un número." })
    .int("El año debe ser entero.")
    .min(2000, "El año debe ser >= 2000.")
    .max(2100, "El año debe ser <= 2100."),
  label: z.string().trim().min(1, "La etiqueta es obligatoria.").max(200, "Máximo 200 caracteres."),
  start_date: z
    .string()
    .trim()
    .min(1, "La fecha de inicio es obligatoria.")
    .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha de inicio inválida."),
  end_date: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((v) => (v ? v : null))
    .refine((v) => v === null || !Number.isNaN(Date.parse(v as string)), "Fecha de fin inválida."),
});

export type CreateCarnivalYearInput = z.infer<typeof createCarnivalYearSchema>;

export const startNewYearSchema = z.object({
  label: z.string().trim().min(1, "La etiqueta es obligatoria.").max(200, "Máximo 200 caracteres."),
  start_date: z
    .string()
    .trim()
    .min(1, "La fecha de inicio es obligatoria.")
    .refine((v) => !Number.isNaN(Date.parse(v)), "Fecha de inicio inválida."),
  confirmText: z.string().trim().min(1, "Debes escribir la confirmación."),
});

export type StartNewYearInput = z.infer<typeof startNewYearSchema>;

export function isCarnivalYearStatus(v: string): v is CarnivalYearStatus {
  return (CARNIVAL_YEAR_STATUSES as readonly string[]).includes(v);
}

export const SNAPSHOT_TYPES = [
  "members",
  "events",
  "questions",
  "votings",
  "payments",
  "attendance",
  "rehearsal_attendance",
  "shifts",
  "formations",
  "instruments",
  "transactions",
  "stats",
] as const;
export type SnapshotType = (typeof SNAPSHOT_TYPES)[number];
