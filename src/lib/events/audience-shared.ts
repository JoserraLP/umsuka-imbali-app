import { z } from "zod";
import type { ComponentType, Workgroup } from "@/types/database.types";

/**
 * Client-safe (isomorphic) audience constants, zod fields/schemas and
 * pure helpers for the event audience feature (Sprint 18).
 *
 * IMPORTANT: this module must stay free of server-only imports
 * (`next/headers`, supabase clients, `@/lib/auth/session`, `server-only`)
 * because client components (`audience-selector`, `audience-editor`,
 * `event-form`, `event-form`'s resolvers) import it directly. The
 * server-side layer `./audience.ts` re-exports everything from here and
 * adds the DB queries/mutations on top, so server modules and tests can
 * keep importing from `./audience`.
 */

// ── Constants + types ───────────────────────────────────

export const AUDIENCE_TYPES = ["all", "workgroup", "member_type", "specific_users"] as const;
export type AudienceTypeValue = (typeof AUDIENCE_TYPES)[number];

export const AUDIENCE_MEMBER_TYPES = ["music", "dance", "member"] as const;
export type AudienceMemberType = (typeof AUDIENCE_MEMBER_TYPES)[number];

/**
 * Workgroups an event audience can target (excludes "ninguno").
 * Mirrors `EVENT_WORKGROUPS` in schema.ts — kept local to avoid the
 * schema -> audience -> schema module cycle.
 */
export const AUDIENCE_WORKGROUPS = ["telas", "barra", "estandarte", "limpieza"] as const;
export type AudienceWorkgroupValue = (typeof AUDIENCE_WORKGROUPS)[number];

export const AUDIENCE_TYPE_LABELS: Record<AudienceTypeValue, string> = {
  all: "Todos los miembros",
  workgroup: "Solo mi grupo de trabajo",
  member_type: "Solo un tipo de miembro",
  specific_users: "Usuarios concretos",
};

export const AUDIENCE_MEMBER_TYPE_LABELS: Record<AudienceMemberType, string> = {
  music: "Música",
  dance: "Baile",
  member: "Socio/a",
};

export const AUDIENCE_WORKGROUP_LABELS: Record<AudienceWorkgroupValue, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
};

function labelOrRaw(labels: Record<string, string>, value: string): string {
  return labels[value] ?? value;
}

// ── Zod fields + cross-field validation ─────────────────

/** Empty string (empty <select> / cleared input) means "no value". */
function normalizeEmptyToNull(value: unknown): unknown {
  if (value === "" || value === null || value === undefined) return null;
  return value;
}

/**
 * Shared audience fields, spread into the event schemas (D6). All fields
 * are optional with defaults (`all` / null / []) so inputs from before
 * Sprint 18 keep parsing.
 */
export const AUDIENCE_FORM_FIELDS = {
  audienceType: z
    .enum(AUDIENCE_TYPES, {
      errorMap: () => ({ message: "Debes elegir a quién se muestra el evento." }),
    })
    .default("all"),
  audienceWorkgroup: z.preprocess(
    normalizeEmptyToNull,
    z
      .enum(AUDIENCE_WORKGROUPS, {
        errorMap: () => ({ message: "Debes elegir un grupo de trabajo válido." }),
      })
      .nullable(),
  ),
  audienceMemberType: z.preprocess(
    normalizeEmptyToNull,
    z
      .enum(AUDIENCE_MEMBER_TYPES, {
        errorMap: () => ({ message: "Debes elegir un tipo de miembro válido." }),
      })
      .nullable(),
  ),
  audienceUserIds: z.array(z.string().uuid("Cada usuario debe ser un UUID válido.")).default([]),
} as const;

export interface AudienceFieldsData {
  audienceType?: AudienceTypeValue | null;
  audienceWorkgroup?: string | null;
  audienceMemberType?: AudienceMemberType | null;
  audienceUserIds?: string[];
}

/**
 * Cross-field superRefine: each restricted audience type requires its
 * companion value. Works on any object that spreads AUDIENCE_FORM_FIELDS.
 */
export function audienceCrossFieldIssueFn(data: AudienceFieldsData, ctx: z.RefinementCtx): void {
  if (data.audienceType === "workgroup" && data.audienceWorkgroup === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["audienceWorkgroup"],
      message: "Debes elegir el grupo de trabajo al que se muestra el evento.",
    });
  }

  if (data.audienceType === "member_type" && data.audienceMemberType === null) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["audienceMemberType"],
      message: "Debes elegir el tipo de miembro al que se muestra el evento.",
    });
  }

  if (data.audienceType === "specific_users" && (data.audienceUserIds ?? []).length === 0) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ["audienceUserIds"],
      message: "Debes seleccionar al menos un usuario.",
    });
  }
}

/** Standalone audience section (used by the quick editor on the detail page). */
export const audienceSchema = z.object(AUDIENCE_FORM_FIELDS).superRefine(audienceCrossFieldIssueFn);
export type AudienceValues = z.infer<typeof audienceSchema>;

/** Audience update mutation input (`updateEventAudience`). */
export const updateEventAudienceSchema = z
  .object({
    eventId: z.string().uuid("El ID del evento debe ser un UUID válido."),
    ...AUDIENCE_FORM_FIELDS,
  })
  .superRefine(audienceCrossFieldIssueFn);
export type UpdateEventAudienceInput = z.infer<typeof updateEventAudienceSchema>;

// ── Pure visibility mirror ─────────────────────────────

export interface AudienceVisibilityContext {
  /** Viewer's workgroup ('ninguno' when none). */
  userWorkgroup: string;
  /** Viewer's component_type (music/dance/member). */
  userComponent: string;
  /** Event ids the viewer is a concrete audience member of. */
  audienceEventIds: Set<string>;
  /** Management always sees everything (mirrors the RLS is_management() branch). */
  isManagement?: boolean;
}

/**
 * Pure mirror of the `events_select_authenticated` RLS policy (D8):
 * an event is visible when the viewer is management, or when BOTH the
 * legacy group rule (visible_to_group) AND the audience rule match.
 * Unknown audience types fail closed; a null audience_type behaves as
 * 'all' (the DB column defaults to 'all' and is NOT NULL).
 */
export function isEventVisibleToAudience(
  event: {
    id: string;
    visibleToGroup: string | null;
    audienceType: string | null;
    audienceWorkgroup: string | null;
    audienceMemberType: string | null;
  },
  ctx: AudienceVisibilityContext,
): boolean {
  if (ctx.isManagement) return true;

  if (event.visibleToGroup !== null && event.visibleToGroup !== ctx.userWorkgroup) {
    return false;
  }

  switch (event.audienceType ?? "all") {
    case "all":
      return true;
    case "workgroup":
      // 'ninguno' can never be an audience target (DB CHECK whitelist);
      // reject it defensively so a corrupt row never leaks to everyone.
      return (
        event.audienceWorkgroup !== null &&
        event.audienceWorkgroup !== "ninguno" &&
        event.audienceWorkgroup === ctx.userWorkgroup
      );
    case "member_type":
      return event.audienceMemberType !== null && event.audienceMemberType === ctx.userComponent;
    case "specific_users":
      return ctx.audienceEventIds.has(event.id);
    default:
      return false;
  }
}

// ── Shared row/option shapes ───────────────────────────

export interface AudienceUser {
  id: string;
  firstName: string;
  lastName: string;
  username: string | null;
}

export interface AudienceMemberOption {
  id: string;
  firstName: string;
  lastName: string;
  username: string | null;
  workgroup: Workgroup;
  componentType: ComponentType;
}

export interface EventAudience {
  audienceType: AudienceTypeValue;
  audienceWorkgroup: Workgroup | null;
  audienceMemberType: AudienceMemberType | null;
  users: AudienceUser[];
}

// ── Labels / summaries ─────────────────────────────────

export interface AudienceSummaryEvent {
  visibleToGroup: string | null;
  audienceType: string | null;
  audienceWorkgroup: string | null;
  audienceMemberType: string | null;
}

/**
 * Human-readable summary of an event's audience, e.g. "Solo grupo: Barra",
 * "Solo Música" or "Usuarios concretos (3)". Falls back to the legacy
 * visible_to_group restriction when the audience is 'all' (work_shift
 * events); returns null for a plain unrestricted audience.
 */
export function getAudienceSummary(event: AudienceSummaryEvent, userCount?: number): string | null {
  switch (event.audienceType ?? "all") {
    case "workgroup":
      return event.audienceWorkgroup !== null
        ? `Solo grupo: ${labelOrRaw(AUDIENCE_WORKGROUP_LABELS, event.audienceWorkgroup)}`
        : null;
    case "member_type":
      return event.audienceMemberType !== null
        ? `Solo ${labelOrRaw(AUDIENCE_MEMBER_TYPE_LABELS, event.audienceMemberType)}`
        : null;
    case "specific_users":
      return `Usuarios concretos (${userCount ?? 0})`;
    case "all":
    default:
      if (event.visibleToGroup !== null) {
        return `Solo grupo: ${labelOrRaw(AUDIENCE_WORKGROUP_LABELS, event.visibleToGroup)}`;
      }
      return null;
  }
}