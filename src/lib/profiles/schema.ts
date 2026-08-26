import { z } from "zod";
import { APP_ROLES } from "@/lib/auth/roles";

/**
 * Hosts allowed for external avatar URLs (https only). Mirrors the
 * image-src allowlist of the app CSP, so a validated URL is also
 * renderable by next/image without any next.config change.
 */
export const AVATAR_ALLOWED_HOSTS = [
  "lh3.googleusercontent.com",
  "supabase.co",
  "images.unsplash.com",
] as const;

/**
 * True when `value` is an https URL hosted on an allowlisted domain.
 * "supabase.co" is matched as a wildcard: the exact host and any
 * `*.supabase.co` subdomain are accepted.
 */
export function isAllowedAvatarUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;

  const host = url.hostname.toLowerCase();
  return (
    host === "lh3.googleusercontent.com" ||
    host === "images.unsplash.com" ||
    host === "supabase.co" ||
    host.endsWith(".supabase.co")
  );
}

/**
 * Normalizes a list of skill tags: trims each one, drops empty items,
 * dedupes case-insensitively (first occurrence wins) and caps the
 * result at 10 items — the same limits the DB CHECK enforces.
 */
export function normalizeSkills(items: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of items) {
    const trimmed = item.trim();
    if (!trimmed) continue;
    const key = trimmed.toLocaleLowerCase();
    if (seen.has(key)) continue;
    if (result.length >= 10) break;
    seen.add(key);
    result.push(trimmed);
  }
  return result;
}

/**
 * Fields a member may edit about their own profile. `role` is
 * intentionally excluded — it can only be changed via
 * updateMemberRoleAction, which enforces RBAC server-side.
 */
export const updateOwnProfileSchema = z.object({
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
  birthDate: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || !Number.isNaN(Date.parse(value)), {
      message: "La fecha de nacimiento debe ser una fecha válida.",
    }),
  componentType: z.enum(["music", "dance", "member"], {
    errorMap: () => ({ message: "El componente debe ser música, baile o socio/a." }),
  }),
  bio: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || value.length <= 500, {
      message: "La biografía no puede superar los 500 caracteres.",
    }),
  phone: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || /^[+0-9 ()-]{6,20}$/.test(value), {
      message:
        "Introduce un teléfono válido (6-20 caracteres; permite +, espacios, guiones y paréntesis).",
    }),
  skills: z
    .array(
      z
        .string()
        .trim()
        .min(1, "Cada habilidad debe tener al menos 1 carácter.")
        .max(50, "Cada habilidad debe tener 50 caracteres o menos."),
    )
    .max(10, "Máximo 10 habilidades.")
    .default([])
    .transform(normalizeSkills),
  avatarUrl: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || isAllowedAvatarUrl(value), {
      message:
        "La URL del avatar debe ser HTTPS y estar alojada en un dominio permitido (Google, Supabase o Unsplash).",
    }),
  joinedAt: z
    .string()
    .trim()
    .nullable()
    .optional()
    .transform((value) => (value ? value : null))
    .refine((value) => value === null || !Number.isNaN(Date.parse(value)), {
      message: "La fecha de incorporación debe ser una fecha válida.",
    })
    .refine((value) => value === null || new Date(value) <= new Date(), {
      message: "La fecha de incorporación no puede ser futura.",
    }),
});

export type UpdateOwnProfileInput = z.infer<typeof updateOwnProfileSchema>;

export const updateMemberRoleSchema = z.object({
  userId: z.string().uuid("El ID de usuario debe ser un UUID válido."),
  role: z.enum(APP_ROLES as [string, ...string[]], {
    errorMap: () => ({ message: "El rol debe ser uno de los roles permitidos por la aplicación." }),
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
  userId: z.string().uuid("El ID de usuario debe ser un UUID válido."),
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
  userId: z.string().uuid("El ID de usuario debe ser un UUID válido."),
  isActive: z.boolean(),
});

export type SetMemberActiveInput = z.infer<typeof setMemberActiveSchema>;

/**
 * Admin-only: changes a member's component type (music/dance/member) from
 * the directory table, without touching any other personal field.
 */
export const setMemberComponentTypeSchema = z.object({
  userId: z.string().uuid("El ID de usuario debe ser un UUID válido."),
  componentType: z.enum(["music", "dance", "member"], {
    errorMap: () => ({ message: "El componente debe ser música, baile o socio/a." }),
  }),
});

export type SetMemberComponentTypeInput = z.infer<typeof setMemberComponentTypeSchema>;

/**
 * Admin-only: changes a member's workgroup from the directory table,
 * without touching any other field. The music/dance-requires-workgroup
 * rule is enforced against the member's CURRENT component type.
 */
export const setMemberWorkgroupSchema = z.object({
  userId: z.string().uuid("El ID de usuario debe ser un UUID válido."),
  workgroup: z.enum(["telas", "barra", "estandarte", "limpieza", "ninguno"], {
    errorMap: () => ({
      message: "El grupo de trabajo debe ser telas, barra, estandarte, limpieza o ninguno.",
    }),
  }),
});

export type SetMemberWorkgroupInput = z.infer<typeof setMemberWorkgroupSchema>;

/**
 * A member chooses their own workgroup (first-time onboarding or a later
 * change from /profile). "ninguno" is deliberately excluded — a real
 * group is mandatory; unassigning is a super-admin decision, so it stays
 * on setMemberWorkgroupSchema.
 */
export const setMyWorkgroupSchema = z.object({
  workgroup: z.enum(["telas", "barra", "estandarte", "limpieza"], {
    errorMap: () => ({ message: "El grupo de trabajo debe ser telas, barra, estandarte o limpieza." }),
  }),
});

export type SetMyWorkgroupInput = z.infer<typeof setMyWorkgroupSchema>;
