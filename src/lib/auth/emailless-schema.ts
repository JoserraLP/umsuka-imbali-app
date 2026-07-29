import { z } from "zod";

/**
 * Schema for the super admin to create an emailless account.
 * The username is used for login instead of email.
 */
export const createEmaillessAccountSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio.")
    .max(100, "El nombre debe tener 100 caracteres o menos."),
  lastName: z
    .string()
    .trim()
    .min(1, "Los apellidos son obligatorios.")
    .max(100, "Los apellidos deben tener 100 caracteres o menos."),
  username: z
    .string()
    .trim()
    .min(3, "El nombre de usuario debe tener al menos 3 caracteres.")
    .max(30, "El nombre de usuario debe tener 30 caracteres o menos.")
    .regex(
      /^[a-zA-Z0-9_]+$/,
      "El nombre de usuario solo puede contener letras, números y guiones bajos.",
    ),
  password: z
    .string()
    .min(8, "La contraseña debe tener al menos 8 caracteres.")
    .max(100, "La contraseña debe tener 100 caracteres o menos."),
  componentType: z.enum(["music", "dance", "member"], {
    errorMap: () => ({ message: "El componente debe ser music, dance o member." }),
  }),
  workgroup: z
    .enum(["telas", "barra", "estandarte", "limpieza", "ninguno"])
    .optional(),
});

export type CreateEmaillessAccountInput = z.infer<typeof createEmaillessAccountSchema>;

/**
 * Schema for resolving a username to an email alias during login.
 */
export const resolveUsernameSchema = z.object({
  username: z.string().trim().min(1, "El nombre de usuario es obligatorio."),
});

export type ResolveUsernameInput = z.infer<typeof resolveUsernameSchema>;

// ── Result types ──────────────────────────────────────────

export interface CreateEmaillessAccountResult {
  success: boolean;
  error?: string;
  credentials?: {
    username: string;
    password: string;
  };
}

export interface ResolveUsernameResult {
  success: boolean;
  error?: string;
  emailAlias?: string;
}

export interface ChangePasswordResult {
  success: boolean;
  error?: string;
}
