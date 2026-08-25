import { z } from "zod";

// ── Helpers ─────────────────────────────────────────

const optionalTrimmedText = (maxLength: number, message: string) =>
  z
    .string()
    .trim()
    .max(maxLength, message)
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function isValidPhone(value: string): boolean {
  return /^[\d\s+\-()]{7,50}$/.test(value);
}

const emailField = z
  .string()
  .trim()
  .max(320, "El email debe tener 320 caracteres o menos.")
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional()
  .refine(
    (value) => value === null || value === undefined || isValidEmail(value),
    "El email no es válido.",
  );

const phoneField = z
  .string()
  .trim()
  .max(50, "El teléfono debe tener 50 caracteres o menos.")
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional()
  .refine(
    (value) => value === null || value === undefined || isValidPhone(value),
    "El teléfono no es válido.",
  );

function guardianCoherenceRefine(
  data: { is_member: boolean; member_user_id?: string | null },
  ctx: z.RefinementCtx,
) {
  if (data.is_member) {
    if (!data.member_user_id) {
      ctx.addIssue({
        code: "custom",
        message: "Si es miembro, debe indicar el usuario miembro.",
        path: ["member_user_id"],
      });
    }
  } else {
    if (data.member_user_id !== null && data.member_user_id !== undefined) {
      ctx.addIssue({
        code: "custom",
        message: "Si no es miembro, no debe indicar member_user_id.",
        path: ["member_user_id"],
      });
    }
  }
}

const baseGuardianFields = {
  full_name: z
    .string()
    .trim()
    .min(1, "El nombre completo es obligatorio.")
    .max(200, "El nombre completo debe tener 200 caracteres o menos."),
  document_id: optionalTrimmedText(50, "El documento debe tener 50 caracteres o menos."),
  email: emailField,
  phone: phoneField,
  relationship: optionalTrimmedText(100, "La relación debe tener 100 caracteres o menos."),
  is_member: z.boolean({
    message: "is_member debe ser un booleano.",
  }),
  member_user_id: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional()
    .refine(
      (value) => value === null || value === undefined || z.string().uuid().safeParse(value).success,
      "member_user_id debe ser un UUID válido.",
    ),
};

// ── Create / Update ─────────────────────────────────

export const createGuardianSchema = z.object(baseGuardianFields).superRefine(guardianCoherenceRefine);

export type CreateGuardianInput = z.infer<typeof createGuardianSchema>;

export const updateGuardianSchema = z
  .object({
    ...baseGuardianFields,
    id: z.string().uuid("id debe ser un UUID válido."),
  })
  .superRefine(guardianCoherenceRefine);

export type UpdateGuardianInput = z.infer<typeof updateGuardianSchema>;

// ── Assign / Unassign ───────────────────────────────

export const assignGuardianSchema = z.object({
  minor_id: z.string().uuid("minor_id debe ser un UUID válido."),
  guardian_id: z.string().uuid("guardian_id debe ser un UUID válido."),
});

export type AssignGuardianInput = z.infer<typeof assignGuardianSchema>;

export const unassignGuardianSchema = z.object({
  minor_id: z.string().uuid("minor_id debe ser un UUID válido."),
});

export type UnassignGuardianInput = z.infer<typeof unassignGuardianSchema>;

// ── Set minor status ────────────────────────────────

export const setMinorStatusSchema = z.object({
  user_id: z.string().uuid("user_id debe ser un UUID válido."),
  is_minor: z.boolean({
    message: "is_minor debe ser un booleano.",
  }),
  legal_guardian_id: z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional()
    .refine(
      (value) => value === null || value === undefined || z.string().uuid().safeParse(value).success,
      "legal_guardian_id debe ser un UUID válido.",
    ),
});

export type SetMinorStatusInput = z.infer<typeof setMinorStatusSchema>;
