import { z } from "zod";
import { AUDIENCE_FORM_FIELDS, audienceCrossFieldIssueFn } from "@/lib/events/audience-shared";

export const EVENT_TYPES = ["general", "meeting", "carnival", "work_shift"] as const;
export type EventTypeValue = (typeof EVENT_TYPES)[number];

/** Workgroups a group-scoped event can target (excludes "ninguno"). */
export const EVENT_WORKGROUPS = ["telas", "barra", "estandarte", "limpieza"] as const;
export type EventWorkgroup = (typeof EVENT_WORKGROUPS)[number];

const EVENT_FORM_FIELDS = {
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
  /**
   * Optional free-text venue/location. An empty or whitespace-only input
   * is normalized to `null` (no location shown).
   */
  location: z
    .string()
    .trim()
    .max(300, "Location must be 300 characters or fewer.")
    .optional()
    .transform((value) => (value ? value : null)),
  /**
   * Optional hero image URL. Only http(s) URLs without whitespace are
   * accepted (mirrors the chk_events_image_url_http DB constraint).
   * Empty input is normalized to `null`.
   */
  imageUrl: z
    .string()
    .trim()
    .max(2000, "Image URL must be 2000 characters or fewer.")
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || /^https?:\/\/[^\s]+$/.test(value), {
      message: "Image URL must be a valid http(s) URL.",
    }),
  /**
   * Optional cutoff instant for new registrations. After it passes,
   * members join the waitlist instead. An empty input is normalized to
   * `null`; the value is kept as provided (datetimes are converted to
   * ISO in the client form before submission).
   */
  registrationDeadline: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || !Number.isNaN(Date.parse(value)), {
      message: "Registration deadline must be a valid date/time.",
    }),
  /**
   * Target workgroup for `work_shift` events. Required for work_shift
   * events (refined below), ignored for all other types.
   */
  workgroup: z
    .enum(EVENT_WORKGROUPS)
    .nullable()
    .optional()
    .transform((value) => value ?? null),
} as const;

function isWorkShift(data: { eventType?: string | null; workgroup?: string | null }): boolean {
  return data.eventType === "work_shift";
}

/**
 * Shared shape used by the client-side form (React Hook Form + Zod). Both
 * create and update use this exact shape for the editable fields, so the
 * form component only ever needs one resolver type regardless of mode.
 * Work_shift events require a target workgroup. The audience fields
 * (Sprint 18) are spread from AUDIENCE_FORM_FIELDS with cross-field
 * validation via audienceCrossFieldIssueFn.
 */
export const eventFormSchema = z
  .object({ ...EVENT_FORM_FIELDS, ...AUDIENCE_FORM_FIELDS })
  .refine((data) => !isWorkShift(data) || data.workgroup !== null, {
    message: "For work shift events you must choose the target workgroup.",
    path: ["workgroup"],
  })
  .superRefine(audienceCrossFieldIssueFn);
export type EventFormValues = z.infer<typeof eventFormSchema>;

export const createEventSchema = z
  .object({ ...EVENT_FORM_FIELDS, ...AUDIENCE_FORM_FIELDS })
  .refine((data) => !isWorkShift(data) || data.workgroup !== null, {
    message: "For work shift events you must choose the target workgroup.",
    path: ["workgroup"],
  })
  .superRefine(audienceCrossFieldIssueFn);
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z
  .object({
    ...EVENT_FORM_FIELDS,
    ...AUDIENCE_FORM_FIELDS,
    id: z.string().uuid("id must be a valid UUID."),
  })
  .refine((data) => !isWorkShift(data) || data.workgroup !== null, {
    message: "For work shift events you must choose the target workgroup.",
    path: ["workgroup"],
  })
  .superRefine(audienceCrossFieldIssueFn);
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const deleteEventSchema = z.object({
  id: z.string().uuid("id must be a valid UUID."),
});
export type DeleteEventInput = z.infer<typeof deleteEventSchema>;

// ── Event comments ────────────────────────────────────

export const addEventCommentSchema = z.object({
  eventId: z.string().uuid("eventId must be a valid UUID."),
  body: z
    .string()
    .trim()
    .min(1, "The comment cannot be empty.")
    .max(1000, "The comment must be 1000 characters or fewer."),
});
export type AddEventCommentInput = z.infer<typeof addEventCommentSchema>;

export const deleteEventCommentSchema = z.object({
  eventId: z.string().uuid("eventId must be a valid UUID."),
  commentId: z.string().uuid("commentId must be a valid UUID."),
});
export type DeleteEventCommentInput = z.infer<typeof deleteEventCommentSchema>;

// ── Event waitlist ────────────────────────────────────

export const WAITLIST_STATUSES = ["waiting", "promoted", "declined", "removed"] as const;
export type WaitlistStatusValue = (typeof WAITLIST_STATUSES)[number];

export const joinWaitlistSchema = z.object({
  eventId: z.string().uuid("eventId must be a valid UUID."),
});
export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;

export const leaveWaitlistSchema = z.object({
  eventId: z.string().uuid("eventId must be a valid UUID."),
});
export type LeaveWaitlistInput = z.infer<typeof leaveWaitlistSchema>;

export const setWaitlistEntryStatusSchema = z.object({
  eventId: z.string().uuid("eventId must be a valid UUID."),
  entryId: z.string().uuid("entryId must be a valid UUID."),
  status: z.enum(WAITLIST_STATUSES, {
    errorMap: () => ({
      message: "Waitlist status must be waiting, promoted, declined or removed.",
    }),
  }),
});
export type SetWaitlistEntryStatusInput = z.infer<typeof setWaitlistEntryStatusSchema>;

/**
 * Management-only: removes a waitlist entry outright (the DB trigger
 * renumbers every later position, keeping the list gapless).
 */
export const removeWaitlistEntrySchema = z.object({
  eventId: z.string().uuid("eventId must be a valid UUID."),
  entryId: z.string().uuid("entryId must be a valid UUID."),
});
export type RemoveWaitlistEntryInput = z.infer<typeof removeWaitlistEntrySchema>;
