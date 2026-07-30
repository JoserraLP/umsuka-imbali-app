import { z } from "zod";


/** All possible workgroup values including "ninguno" (no filter). */
export const WORKGROUPS = ["telas", "barra", "estandarte", "limpieza", "ninguno"] as const;

/**
 * Base field definitions shared across form, create, and update schemas.
 * Kept as a plain object so it can be spread into each schema (avoids
 * ZodEffects.extend issues caused by .refine()).
 */
const SHIFT_FORM_FIELDS = {
  name: z
    .string()
    .trim()
    .min(1, "El nombre del turno es obligatorio.")
    .max(200, "El nombre debe tener 200 caracteres o menos."),
  startTime: z
    .string()
    .trim()
    .min(1, "La hora de inicio es obligatoria."),
  endTime: z
    .string()
    .trim()
    .min(1, "La hora de fin es obligatoria."),
  maxAssignees: z
    .union([z.number(), z.nan()])
    .nullable()
    .optional()
    .transform((value) => (typeof value === "number" && !Number.isNaN(value) ? value : null))
    .refine((value) => value === null || (Number.isInteger(value) && value > 0), {
      message: "El máximo debe ser un número entero positivo.",
    }),
  workgroup: z.enum(WORKGROUPS).nullable().optional().transform((value) => value ?? null),
  notes: z
    .string()
    .trim()
    .max(500, "Las notas deben tener 500 caracteres o menos.")
    .optional()
    .transform((value) => (value ? value : null)),
} as const;

/**
 * Shared form shape used by both create and edit forms.
 * Includes the endTime-after-startTime refinement.
 */
export const shiftFormSchema = z.object(SHIFT_FORM_FIELDS).refine(
  (data) => {
    if (!data.startTime || !data.endTime) return true;
    return new Date(data.startTime) < new Date(data.endTime);
  },
  {
    message: "La hora de fin debe ser posterior a la hora de inicio.",
    path: ["endTime"],
  },
);

export type ShiftFormValues = z.infer<typeof shiftFormSchema>;

export const createShiftSchema = z
  .object({
    ...SHIFT_FORM_FIELDS,
    eventId: z.string().uuid("eventId debe ser un UUID válido."),
  })
  .refine(
    (data) => {
      if (!data.startTime || !data.endTime) return true;
      return new Date(data.startTime) < new Date(data.endTime);
    },
    {
      message: "La hora de fin debe ser posterior a la hora de inicio.",
      path: ["endTime"],
    },
  );
export type CreateShiftInput = z.infer<typeof createShiftSchema>;

export const updateShiftSchema = z
  .object({
    ...SHIFT_FORM_FIELDS,
    id: z.string().uuid("id debe ser un UUID válido."),
    eventId: z.string().uuid("eventId debe ser un UUID válido."),
  })
  .refine(
    (data) => {
      if (!data.startTime || !data.endTime) return true;
      return new Date(data.startTime) < new Date(data.endTime);
    },
    {
      message: "La hora de fin debe ser posterior a la hora de inicio.",
      path: ["endTime"],
    },
  );
export type UpdateShiftInput = z.infer<typeof updateShiftSchema>;

export const deleteShiftSchema = z.object({
  id: z.string().uuid("id debe ser un UUID válido."),
});
export type DeleteShiftInput = z.infer<typeof deleteShiftSchema>;

export const assignMemberSchema = z.object({
  shiftId: z.string().uuid("shiftId debe ser un UUID válido."),
  userId: z.string().uuid("userId debe ser un UUID válido."),
});
export type AssignMemberInput = z.infer<typeof assignMemberSchema>;

export const unassignMemberSchema = z.object({
  assignmentId: z.string().uuid("assignmentId debe ser un UUID válido."),
});
export type UnassignMemberInput = z.infer<typeof unassignMemberSchema>;
