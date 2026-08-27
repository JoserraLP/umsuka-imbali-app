import { z } from "zod";

// ── Shared constants ───────────────────────────────────

export const MAX_VOTING_OPTIONS = 20;

// ── Shared form shape used by the create form ──────────

export const votingFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "El título es obligatorio.")
    .max(200, "El título debe tener 200 caracteres o menos."),
  description: z
    .string()
    .trim()
    .max(5000, "La descripción debe tener 5000 caracteres o menos.")
    .nullable()
    .optional()
    .transform((value) => (value ? value : null)),
  voting_deadline: z
    .string()
    .datetime({ message: "La fecha límite debe ser una fecha válida." })
    // Creation-time rule: the deadline must be in the future. The form
    // resolver normalizes raw datetime-local values to ISO before this
    // check runs.
    .refine((value) => new Date(value).getTime() > Date.now(), {
      message: "La fecha límite debe ser en el futuro.",
    })
    .nullable()
    .optional(),
  options: z
    .array(
      z
        .string()
        .trim()
        .min(1, "Cada opción debe tener al menos 1 carácter.")
        .max(200, "Cada opción debe tener 200 caracteres o menos."),
    )
    .min(2, "Se necesitan al menos 2 opciones.")
    .max(MAX_VOTING_OPTIONS, "Máximo 20 opciones.")
    .refine(
      (options) => {
        const normalized = options.map((option) =>
          option.toLocaleLowerCase(),
        );
        return new Set(normalized).size === normalized.length;
      },
      {
        message:
          "Las opciones no pueden repetirse (mismo texto, sin distinguir mayúsculas).",
      },
    ),
});

export type VotingFormValues = z.infer<typeof votingFormSchema>;

export const createVotingSchema = votingFormSchema;
export type CreateVotingInput = z.infer<typeof createVotingSchema>;

export const addOptionSchema = z.object({
  voting_id: z.string().uuid("voting_id debe ser un UUID válido."),
  option_text: z
    .string()
    .trim()
    .min(1, "La opción no puede estar vacía.")
    .max(200, "La opción debe tener 200 caracteres o menos."),
});
export type AddOptionInput = z.infer<typeof addOptionSchema>;

export const castVoteSchema = z.object({
  voting_id: z.string().uuid("voting_id debe ser un UUID válido."),
  option_id: z.string().uuid("option_id debe ser un UUID válido."),
});
export type CastVoteInput = z.infer<typeof castVoteSchema>;

export const closeVotingSchema = z.object({
  voting_id: z.string().uuid("voting_id debe ser un UUID válido."),
});
export type CloseVotingInput = z.infer<typeof closeVotingSchema>;

export const deleteVotingSchema = z.object({
  voting_id: z.string().uuid("voting_id debe ser un UUID válido."),
});
export type DeleteVotingInput = z.infer<typeof deleteVotingSchema>;