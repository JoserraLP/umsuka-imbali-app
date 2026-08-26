import { z } from "zod";

export const requestAbsenceSchema = z.object({
  eventId: z.string().uuid("El ID del evento debe ser un UUID válido."),
  reason: z
    .string()
    .trim()
    .min(1, "El motivo de la ausencia es obligatorio.")
    .max(500, "El motivo debe tener 500 caracteres o menos."),
});
export type RequestAbsenceInput = z.infer<typeof requestAbsenceSchema>;

export const justifyAbsenceSchema = z.object({
  absenceId: z.string().uuid("El ID de la ausencia debe ser un UUID válido."),
  justified: z.boolean({ required_error: "Debes indicar si está justificada.", invalid_type_error: "Debes indicar si está justificada." }),
});
export type JustifyAbsenceInput = z.infer<typeof justifyAbsenceSchema>;

export const deleteAbsenceSchema = z.object({
  absenceId: z.string().uuid("El ID de la ausencia debe ser un UUID válido."),
});
export type DeleteAbsenceInput = z.infer<typeof deleteAbsenceSchema>;
