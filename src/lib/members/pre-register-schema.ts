import { z } from "zod";

export const WORKGROUP_OPTIONS = ["telas", "barra", "estandarte", "limpieza", "ninguno"] as const;
export const COMPONENT_TYPE_OPTIONS = ["music", "dance", "member"] as const;

/**
 * Pre-registro sin Gmail: el super_admin crea el perfil completo sin email.
 * Todos los mensajes en es-ES.
 */
export const preRegisterMemberSchema = z.object({
  first_name: z
    .string()
    .trim()
    .min(1, "El nombre es obligatorio.")
    .max(100, "El nombre no puede superar 100 caracteres."),
  last_name: z
    .string()
    .trim()
    .min(1, "Los apellidos son obligatorios.")
    .max(100, "Los apellidos no pueden superar 100 caracteres."),
  birth_date: z.string().nullable().optional(),
  component_type: z.enum(COMPONENT_TYPE_OPTIONS, {
    errorMap: () => ({ message: "Tipo de miembro no válido." }),
  }),
  workgroup: z.enum(WORKGROUP_OPTIONS, {
    errorMap: () => ({ message: "Grupo de trabajo no válido." }),
  }),
  role: z.string().trim().min(1, "El rol es obligatorio.").max(50, "El rol no puede superar 50 caracteres.").optional().default("member"),
  is_minor: z.boolean().optional().default(false),
  document_id: z
    .string()
    .trim()
    .max(20, "El documento no puede superar 20 caracteres.")
    .optional()
    .nullable(),
  pending_email: z
    .string()
    .trim()
    .email("El email pendiente no tiene un formato válido.")
    .optional()
    .nullable(),
});

export type PreRegisterMemberInput = z.infer<typeof preRegisterMemberSchema>;

/**
 * Vinculación posterior: super_admin asocia un Gmail a un perfil pending_gmail.
 */
export const linkGmailSchema = z.object({
  profileId: z.string().uuid("El identificador del perfil no es válido."),
  gmail: z
    .string()
    .trim()
    .email("El Gmail no tiene un formato válido.")
    .min(5, "El Gmail es obligatorio."),
  invite_token: z.string().trim().min(8, "El token de invitación no es válido.").optional().nullable(),
});

export type LinkGmailInput = z.infer<typeof linkGmailSchema>;
