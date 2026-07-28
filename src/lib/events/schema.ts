import { z } from "zod";

export const EVENT_TYPES = ["general", "meeting", "carnival", "work_shift"] as const;
export type EventTypeValue = (typeof EVENT_TYPES)[number];

const baseEventFields = {
  title: z
    .string()
    .trim()
    .min(1, "Title is required.")
    .max(200, "Title must be 200 characters or fewer."),
  description: z
    .string()
    .trim()
    .max(2000, "Description must be 2000 characters or fewer.")
    .optional()
    .transform((value) => (value ? value : null)),
  eventType: z.enum(EVENT_TYPES, {
    errorMap: () => ({ message: "Event type must be general, meeting, carnival or work_shift." }),
  }),
  eventDate: z
    .string()
    .trim()
    .min(1, "Event date is required.")
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "Event date must be a valid date/time.",
    }),
  /**
   * Maximum number of registrations. `null` means unlimited. The form
   * field is a number input using RHF's `valueAsNumber`, so an empty
   * field arrives here as `NaN` — normalized to `null` below.
   */
  capacity: z
    .union([z.number(), z.nan()])
    .nullable()
    .optional()
    .transform((value) => (typeof value === "number" && !Number.isNaN(value) ? value : null))
    .refine((value) => value === null || (Number.isInteger(value) && value > 0), {
      message: "Capacity must be a positive whole number.",
    }),
};

/**
 * Shared shape used by the client-side form (React Hook Form + Zod). Both
 * create and update use this exact shape for the editable fields, so the
 * form component only ever needs one resolver type regardless of mode.
 */
export const eventFormSchema = z.object(baseEventFields);
export type EventFormValues = z.infer<typeof eventFormSchema>;

export const createEventSchema = eventFormSchema;
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = eventFormSchema.extend({
  id: z.string().uuid("id must be a valid UUID."),
});
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const deleteEventSchema = z.object({
  id: z.string().uuid("id must be a valid UUID."),
});
export type DeleteEventInput = z.infer<typeof deleteEventSchema>;
