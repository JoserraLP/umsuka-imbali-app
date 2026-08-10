import { z } from "zod";

// ── Shared constants ──────────────────────────────────

export const QUESTION_CATEGORIES = [
  "general",
  "ensayo",
  "evento",
  "vestuario",
  "musica",
  "otro",
] as const;

export const QUESTION_PRIORITIES = ["baja", "media", "alta"] as const;

export type QuestionCategory = (typeof QUESTION_CATEGORIES)[number];
export type QuestionPriority = (typeof QUESTION_PRIORITIES)[number];

// ── Base field definitions shared across form, create, and update schemas ──

const QUESTION_FORM_FIELDS = {
  title: z
    .string()
    .trim()
    .min(1, "El título es obligatorio.")
    .max(200, "El título debe tener 200 caracteres o menos."),
  content: z
    .string()
    .trim()
    .min(1, "La descripción es obligatoria.")
    .max(5000, "La descripción debe tener 5000 caracteres o menos."),
  category: z
    .enum(QUESTION_CATEGORIES, {
      errorMap: () => ({ message: "Selecciona una categoría válida." }),
    })
    .default("general"),
  priority: z
    .enum(QUESTION_PRIORITIES, {
      errorMap: () => ({ message: "Selecciona una prioridad válida." }),
    })
    .default("media"),
} as const;

/**
 * Shared form shape used by the create form.
 */
export const questionFormSchema = z.object(QUESTION_FORM_FIELDS);
export type QuestionFormValues = z.infer<typeof questionFormSchema>;

export const createQuestionSchema = questionFormSchema;
export type CreateQuestionInput = z.infer<typeof createQuestionSchema>;

export const updateQuestionSchema = questionFormSchema.extend({
  id: z.string().uuid("id debe ser un UUID válido."),
});
export type UpdateQuestionInput = z.infer<typeof updateQuestionSchema>;

export const deleteQuestionSchema = z.object({
  id: z.string().uuid("id debe ser un UUID válido."),
});
export type DeleteQuestionInput = z.infer<typeof deleteQuestionSchema>;

export const resolveQuestionSchema = z.object({
  id: z.string().uuid("id debe ser un UUID válido."),
  resolved: z.boolean(),
});
export type ResolveQuestionInput = z.infer<typeof resolveQuestionSchema>;

export const addCommentSchema = z.object({
  question_id: z.string().uuid("id de pregunta debe ser un UUID válido."),
  content: z
    .string()
    .trim()
    .min(1, "El comentario no puede estar vacío.")
    .max(2000, "El comentario debe tener 2000 caracteres o menos."),
});
export type AddCommentInput = z.infer<typeof addCommentSchema>;
