import { z } from "zod";
import { APP_ROLES } from "@/lib/auth/roles";

/**
 * Fields a member may edit about their own profile. `role` is
 * intentionally excluded — it can only be changed via
 * updateMemberRoleAction, which enforces RBAC server-side.
 */
export const updateOwnProfileSchema = z.object({
  firstName: z
    .string()
    .trim()
    .min(1, "First name is required.")
    .max(100, "First name must be 100 characters or fewer."),
  lastName: z
    .string()
    .trim()
    .min(1, "Last name is required.")
    .max(100, "Last name must be 100 characters or fewer."),
  birthDate: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || !Number.isNaN(Date.parse(value)), {
      message: "Birth date must be a valid date.",
    }),
  componentType: z.enum(["music", "dance", "member"], {
    errorMap: () => ({ message: "Component type must be music, dance or member." }),
  }),
});

export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileSchema>;

export const updateMemberRoleSchema = z.object({
  userId: z.string().uuid("userId must be a valid UUID."),
  role: z.enum(APP_ROLES as [string, ...string[]], {
    errorMap: () => ({ message: "role must be one of the defined application roles." }),
  }),
});

export type UpdateMemberRoleInput = z.infer<typeof updateMemberRoleSchema>;

/**
 * Admin-only: edits the personal fields of ANY member's profile (not
 * just the caller's own), including their workgroup. Deliberately
 * excludes `role` — that stays on updateMemberRoleSchema, which has its
 * own dedicated privilege checks.
 */
export const updateMemberProfileSchema = updateOwnProfileSchema.extend({
  userId: z.string().uuid("userId must be a valid UUID."),
  // When omitted, the member's current workgroup is preserved.
  workgroup: z.enum(["telas", "barra", "estandarte", "limpieza", "ninguno"]).optional(),
});

export type UpdateMemberProfileInput = z.infer<typeof updateMemberProfileSchema>;

/**
 * Admin-only: activates ("alta") or deactivates ("baja") a member. A
 * deactivated member is treated as logged out at the application layer
 * regardless of holding a valid Supabase Auth session.
 */
export const setMemberActiveSchema = z.object({
  userId: z.string().uuid("userId must be a valid UUID."),
  isActive: z.boolean(),
});

export type SetMemberActiveInput = z.infer<typeof setMemberActiveSchema>;

/**
 * Admin-only: changes a member's component type (music/dance/member) from
 * the directory table, without touching any other personal field.
 */
export const setMemberComponentTypeSchema = z.object({
  userId: z.string().uuid("userId must be a valid UUID."),
  componentType: z.enum(["music", "dance", "member"], {
    errorMap: () => ({ message: "Component type must be music, dance or member." }),
  }),
});

export type SetMemberComponentTypeInput = z.infer<typeof setMemberComponentTypeSchema>;
