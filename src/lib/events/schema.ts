import { z } from "zod";
import { AUDIENCE_FORM_FIELDS, audienceCrossFieldIssueFn } from "@/lib/events/audience-shared";

export const EVENT_TYPES = ["general", "meeting", "carnival", "work_shift", "rehearsal", "material_distribution"] as const;
export type EventTypeValue = (typeof EVENT_TYPES)[number];

export const REHEARSAL_CATEGORIES = ["music", "dance"] as const;
export type RehearsalCategoryValue = (typeof REHEARSAL_CATEGORIES)[number];

/** Workgroups a group-scoped event can target (excludes "ninguno"). */
export const EVENT_WORKGROUPS = ["telas", "barra", "estandarte", "limpieza"] as const;
export type EventWorkgroup = (typeof EVENT_WORKGROUPS)[number];

const EVENT_FORM_FIELDS = {
  title: z
    .string()
    .trim()
    .min(1, "El título es obligatorio.")
    .max(200, "El título debe tener 200 caracteres o menos."),
  description: z
    .string()
    .trim()
    .max(2000, "La descripción debe tener 2000 caracteres o menos.")
    .optional()
    .transform((value) => (value ? value : null)),
  eventType: z.enum(EVENT_TYPES, {
    errorMap: () => ({
      message: "El tipo de evento debe ser general, reunión, carnaval, turno de trabajo, ensayo o reparto de material.",
    }),
  }),
  eventDate: z
    .string()
    .trim()
    .min(1, "La fecha del evento es obligatoria.")
    .refine((value) => !Number.isNaN(Date.parse(value)), {
      message: "La fecha del evento debe ser una fecha válida.",
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
       message: "El aforo debe ser un número entero positivo.",
     }),
  /**
   * Optional free-text venue/location. An empty or whitespace-only input
   * is normalized to `null` (no location shown).
   */
  location: z
    .string()
    .trim()
    .max(300, "La ubicación debe tener 300 caracteres o menos.")
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
    .max(2000, "La URL de la imagen debe tener 2000 caracteres o menos.")
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || /^https?:\/\/[^\s]+$/.test(value), {
      message: "La URL de la imagen debe ser una URL http(s) válida.",
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
      message: "La fecha límite de inscripción debe ser una fecha válida.",
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
   /**
    * Rehearsal session flags (Sprint 27). Only meaningful for
    * `rehearsal` events; at least one must be true (refined below).
    * Checkboxes default to unchecked, and the DB CHECK constraints
    * mirror these rules (`chk_events_rehearsal_has_session`,
    * `chk_events_non_rehearsal_no_sessions`).
    */
   morningSession: z.boolean().default(false),
   afternoonSession: z.boolean().default(false),
   /**
    * Rehearsal ensemble category (Sprint 32). Only for rehearsal events:
    * music = todos los miembros con component_type=music, dance = baile.
    * NULL for non-rehearsal. Maps to profiles.component_type, NOT workgroup.
    */
   rehearsalCategory: z
     .enum(REHEARSAL_CATEGORIES)
     .nullable()
     .optional()
     .transform((value) => value ?? null),
 } as const;

function isWorkShift(data: { eventType?: string | null; workgroup?: string | null }): boolean {
  return data.eventType === "work_shift";
}

/**
 * Cross-field rule: a rehearsal event must enable at least one session.
 * Non-rehearsal events always pass (their flags are normalized to false
 * before persisting).
 */
function hasRequiredRehearsalSessions(data: {
  eventType?: string | null;
  morningSession?: boolean;
  afternoonSession?: boolean;
}): boolean {
  if (data.eventType !== "rehearsal") {
    return true;
  }
  return data.morningSession === true || data.afternoonSession === true;
}

function hasRequiredRehearsalCategory(data: {
  eventType?: string | null;
  rehearsalCategory?: string | null;
}): boolean {
  if (data.eventType !== "rehearsal") {
    return data.rehearsalCategory === null || data.rehearsalCategory === undefined;
  }
  return data.rehearsalCategory === "music" || data.rehearsalCategory === "dance";
}

/**
 * Shared shape used by the client-side form (React Hook Form + Zod). Both
 * create and update use this exact shape for the editable fields, so the
 * form component only ever needs one resolver type regardless of mode.
 * Work_shift events require a target workgroup; rehearsal events require
 * at least one session (morning/afternoon). The audience fields
 * (Sprint 18) are spread from AUDIENCE_FORM_FIELDS with cross-field
 * validation via audienceCrossFieldIssueFn.
 */
export const eventFormSchema = z
  .object({ ...EVENT_FORM_FIELDS, ...AUDIENCE_FORM_FIELDS })
  .refine((data) => !isWorkShift(data) || data.workgroup !== null, {
    message: "Para eventos de turno de trabajo debes elegir el grupo de trabajo.",
    path: ["workgroup"],
  })
  .refine(hasRequiredRehearsalSessions, {
    message: "Un ensayo debe tener al menos una sesión (mañana o tarde).",
    path: ["morningSession"],
  })
  .refine(hasRequiredRehearsalCategory, {
    message: "Elige categoría de ensayo: música o baile.",
    path: ["rehearsalCategory"],
  })
  .superRefine(audienceCrossFieldIssueFn);
export type EventFormValues = z.infer<typeof eventFormSchema>;

export const createEventSchema = z
  .object({ ...EVENT_FORM_FIELDS, ...AUDIENCE_FORM_FIELDS })
  .refine((data) => !isWorkShift(data) || data.workgroup !== null, {
    message: "Para eventos de turno de trabajo debes elegir el grupo de trabajo.",
    path: ["workgroup"],
  })
  .refine(hasRequiredRehearsalSessions, {
    message: "Un ensayo debe tener al menos una sesión (mañana o tarde).",
    path: ["morningSession"],
  })
  .refine(hasRequiredRehearsalCategory, {
    message: "Elige categoría de ensayo: música o baile.",
    path: ["rehearsalCategory"],
  })
  .superRefine(audienceCrossFieldIssueFn);
export type CreateEventInput = z.infer<typeof createEventSchema>;

export const updateEventSchema = z
  .object({
    ...EVENT_FORM_FIELDS,
    ...AUDIENCE_FORM_FIELDS,
    id: z.string().uuid("El ID del evento debe ser un UUID válido."),
  })
  .refine((data) => !isWorkShift(data) || data.workgroup !== null, {
    message: "Para eventos de turno de trabajo debes elegir el grupo de trabajo.",
    path: ["workgroup"],
  })
  .refine(hasRequiredRehearsalSessions, {
    message: "Un ensayo debe tener al menos una sesión (mañana o tarde).",
    path: ["morningSession"],
  })
  .refine(hasRequiredRehearsalCategory, {
    message: "Elige categoría de ensayo: música o baile.",
    path: ["rehearsalCategory"],
  })
  .superRefine(audienceCrossFieldIssueFn);
export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const deleteEventSchema = z.object({
  id: z.string().uuid("El ID del evento debe ser un UUID válido."),
});
export type DeleteEventInput = z.infer<typeof deleteEventSchema>;

// ── Event comments ────────────────────────────────────

export const addEventCommentSchema = z.object({
  eventId: z.string().uuid("El ID del evento debe ser un UUID válido."),
  body: z
    .string()
    .trim()
    .min(1, "El comentario no puede estar vacío.")
    .max(1000, "El comentario debe tener 1000 caracteres o menos."),
});
export type AddEventCommentInput = z.infer<typeof addEventCommentSchema>;

export const deleteEventCommentSchema = z.object({
  eventId: z.string().uuid("El ID del evento debe ser un UUID válido."),
  commentId: z.string().uuid("El ID del comentario debe ser un UUID válido."),
});
export type DeleteEventCommentInput = z.infer<typeof deleteEventCommentSchema>;

// ── Event waitlist ────────────────────────────────────

export const WAITLIST_STATUSES = ["waiting", "promoted", "declined", "removed"] as const;
export type WaitlistStatusValue = (typeof WAITLIST_STATUSES)[number];

export const joinWaitlistSchema = z.object({
  eventId: z.string().uuid("El ID del evento debe ser un UUID válido."),
});
export type JoinWaitlistInput = z.infer<typeof joinWaitlistSchema>;

export const leaveWaitlistSchema = z.object({
  eventId: z.string().uuid("El ID del evento debe ser un UUID válido."),
});
export type LeaveWaitlistInput = z.infer<typeof leaveWaitlistSchema>;

export const setWaitlistEntryStatusSchema = z.object({
  eventId: z.string().uuid("El ID del evento debe ser un UUID válido."),
  entryId: z.string().uuid("El ID de la entrada debe ser un UUID válido."),
  status: z.enum(WAITLIST_STATUSES, {
    errorMap: () => ({
      message: "El estado de la lista de espera debe ser en espera, promocionado, rechazado o eliminado.",
    }),
  }),
});
export type SetWaitlistEntryStatusInput = z.infer<typeof setWaitlistEntryStatusSchema>;

/**
 * Management-only: removes a waitlist entry outright (the DB trigger
 * renumbers every later position, keeping the list gapless).
 */
export const removeWaitlistEntrySchema = z.object({
  eventId: z.string().uuid("El ID del evento debe ser un UUID válido."),
  entryId: z.string().uuid("El ID de la entrada debe ser un UUID válido."),
});
export type RemoveWaitlistEntryInput = z.infer<typeof removeWaitlistEntrySchema>;
