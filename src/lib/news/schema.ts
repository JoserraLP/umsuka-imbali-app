import { z } from "zod";

// ── Base field definitions shared across form, create, and update schemas ──
const NEWS_FORM_FIELDS = {
  title: z
    .string()
    .trim()
    .min(1, "El título es obligatorio.")
    .max(200, "El título debe tener 200 caracteres o menos."),
  content: z
    .string()
    .trim()
    .min(1, "El contenido es obligatorio.")
    .max(10000, "El contenido debe tener 10000 caracteres o menos."),
  image_url: z
    .union([z.string().url("La URL de la imagen no es válida."), z.literal(""), z.null()])
    .optional()
    .transform((v) => (v && v.trim() ? v.trim() : null)),
  published: z.boolean().default(false),
  pinned: z.boolean().default(false),
} as const;

/**
 * Shared form shape used by both create and edit forms.
 */
export const newsFormSchema = z.object(NEWS_FORM_FIELDS);
export type NewsFormValues = z.infer<typeof newsFormSchema>;

export const createNewsSchema = newsFormSchema;
export type CreateNewsInput = z.infer<typeof createNewsSchema>;

export const updateNewsSchema = newsFormSchema.extend({
  id: z.string().uuid("id debe ser un UUID válido."),
});
export type UpdateNewsInput = z.infer<typeof updateNewsSchema>;

export const deleteNewsSchema = z.object({
  id: z.string().uuid("id debe ser un UUID válido."),
});
export type DeleteNewsInput = z.infer<typeof deleteNewsSchema>;

export const togglePinSchema = z.object({
  id: z.string().uuid("id debe ser un UUID válido."),
});
export type TogglePinInput = z.infer<typeof togglePinSchema>;
