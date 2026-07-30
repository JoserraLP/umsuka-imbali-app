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

// ── Login schema ─────────────────────────────────────────
export const loginSchema = z.object({
  username: z.string().trim().min(1, "El nombre de usuario es obligatorio."),
  password: z.string().min(1, "La contraseña es obligatoria."),
});

export type LoginInput = z.infer<typeof loginSchema>;

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
export interface LoginResult {
  success: boolean;
  error?: string;
  errorCode?:
    | "invalid_credentials"
    | "account_locked"
    | "account_not_found"
    | "wrong_auth_method";
  blockedUntil?: string; // ISO timestamp if account_locked
}

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
