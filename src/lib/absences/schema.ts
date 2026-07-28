import { z } from "zod";

export const requestAbsenceSchema = z.object({
  eventId: z.string().uuid("eventId must be a valid UUID."),
  reason: z
    .string()
    .trim()
    .min(1, "Reason is required.")
    .max(500, "Reason must be 500 characters or fewer."),
});
export type RequestAbsenceInput = z.infer<typeof requestAbsenceSchema>;

export const justifyAbsenceSchema = z.object({
  absenceId: z.string().uuid("absenceId must be a valid UUID."),
  justified: z.boolean({ required_error: "justified is required." }),
});
export type JustifyAbsenceInput = z.infer<typeof justifyAbsenceSchema>;

export const deleteAbsenceSchema = z.object({
  absenceId: z.string().uuid("absenceId must be a valid UUID."),
});
export type DeleteAbsenceInput = z.infer<typeof deleteAbsenceSchema>;
