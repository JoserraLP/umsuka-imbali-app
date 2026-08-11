import { z } from "zod";
import type {
  AppRole,
  AuthMethod,
  ComponentType,
  UserStatus,
  Workgroup,
} from "@/types/database.types";

// ── Filter schema (parsed from URL searchParams on /members) ──

export const WORKGROUP_OPTIONS = ["telas", "barra", "estandarte", "limpieza", "ninguno"] as const;
export const COMPONENT_TYPE_OPTIONS = ["music", "dance", "member"] as const;
export const STATUS_OPTIONS = ["pending", "active", "suspended"] as const;

/**
 * Parses the optional /members query filters. Every field is optional so
 * an empty params object parses to defaults (all filters unset).
 * `q` is trimmed; an empty string after trimming becomes `undefined`.
 */
export const memberFiltersSchema = z.object({
  workgroup: z
    .enum(WORKGROUP_OPTIONS, { errorMap: () => ({ message: "Grupo de trabajo no válido." }) })
    .optional(),
  componentType: z
    .enum(COMPONENT_TYPE_OPTIONS, { errorMap: () => ({ message: "Componente no válido." }) })
    .optional(),
  status: z
    .enum(STATUS_OPTIONS, { errorMap: () => ({ message: "Estado no válido." }) })
    .optional(),
  q: z
    .string()
    .trim()
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type MemberFilters = z.infer<typeof memberFiltersSchema>;

// ── Domain shapes (camelCase, mapped from umsuka.profiles rows) ──

export interface MemberListItem {
  id: string;
  firstName: string;
  lastName: string;
  componentType: ComponentType;
  workgroup: Workgroup;
  role: AppRole;
  isActive: boolean;
  status: UserStatus;
  username: string | null;
  authMethod: AuthMethod;
  createdAt: string;
}

export interface MemberDetail extends MemberListItem {
  birthDate: string | null;
}
