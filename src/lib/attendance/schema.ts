import { z } from "zod";

export const markAttendanceSchema = z.object({
  eventId: z.string().uuid("eventId must be a valid UUID."),
  userId: z.string().uuid("userId must be a valid UUID."),
  attended: z.boolean({ required_error: "attended is required." }),
});
export type MarkAttendanceInput = z.infer<typeof markAttendanceSchema>;

export const markMultipleAttendanceSchema = z.object({
  records: z
    .array(markAttendanceSchema)
    .min(1, "At least one attendance record is required."),
});
export type MarkMultipleAttendanceInput = z.infer<typeof markMultipleAttendanceSchema>;

export const updateAttendanceSchema = z.object({
  id: z.string().uuid("id must be a valid UUID."),
  attended: z.boolean({ required_error: "attended is required." }),
});
export type UpdateAttendanceInput = z.infer<typeof updateAttendanceSchema>;

export const deleteAttendanceSchema = z.object({
  id: z.string().uuid("id must be a valid UUID."),
});
export type DeleteAttendanceInput = z.infer<typeof deleteAttendanceSchema>;
