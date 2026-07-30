import { z } from "zod";

// ── Password strength validation ─────────────────────────
// - 8+ characters
// - At least 1 uppercase letter
// - At least 1 lowercase letter
// - At least 1 digit
// - At least 1 special character

export const passwordStrengthSchema = z
  .string()
  .min(8, "La contraseña debe tener al menos 8 caracteres.")
  .max(100, "La contraseña debe tener 100 caracteres o menos.")
  .regex(/[A-Z]/, "La contraseña debe contener al menos una mayúscula.")
  .regex(/[a-z]/, "La contraseña debe contener al menos una minúscula.")
  .regex(/[0-9]/, "La contraseña debe contener al menos un número.")
  .regex(
    /[^a-zA-Z0-9]/,
    "La contraseña debe contener al menos un carácter especial (ej. !@#$%).",
  );

// ── Reset password schema ─────────────────────────────────
export const resetPasswordSchema = z
  .object({
    token: z.string().uuid("Token inválido."),
    password: passwordStrengthSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmPassword"],
  });

export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;

// ── Generate reset token schema (admin) ───────────────────
export const generateResetTokenSchema = z.object({
  profileId: z.string().uuid("ID de perfil inválido."),
});

export type GenerateResetTokenInput = z.infer<typeof generateResetTokenSchema>;

// ── Change password schema (authenticated user) ───────────
export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "La contraseña actual es obligatoria."),
    newPassword: passwordStrengthSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: "Las contraseñas no coinciden.",
    path: ["confirmPassword"],
  });

export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

// ── Result types ─────────────────────────────────────────
export interface ResetPasswordResult {
  success: boolean;
  error?: string;
}

export interface GenerateResetTokenResult {
  success: boolean;
  error?: string;
  token?: string;
  expiresAt?: string;
}
