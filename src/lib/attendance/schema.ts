import { z } from "zod";

export const markAttendanceSchema = z.object({
  eventId: z.string().uuid("El ID del evento debe ser un UUID válido."),
  userId: z.string().uuid("El ID del usuario debe ser un UUID válido."),
  attended: z.boolean({ required_error: "Debes indicar si asistió.", invalid_type_error: "Debes indicar si asistió." }),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

export const markMultipleAttendanceSchema = z.object({
  records: z
    .array(markAttendanceSchema)
    .min(1, "Se requiere al menos un registro de asistencia."),
});
export type MarkMultipleAttendanceInput = z.infer<typeof markMultipleAttendanceSchema>;

export const updateAttendanceSchema = z.object({
  id: z.string().uuid("El ID del registro debe ser un UUID válido."),
  attended: z.boolean({ required_error: "Debes indicar si asistió.", invalid_type_error: "Debes indicar si asistió." }),
});
export type UpdateAttendanceInput = z.infer<typeof updateAttendanceSchema>;

export const deleteAttendanceSchema = z.object({
  id: z.string().uuid("El ID del registro debe ser un UUID válido."),
});
export type DeleteAttendanceInput = z.infer<typeof deleteAttendanceSchema>;
