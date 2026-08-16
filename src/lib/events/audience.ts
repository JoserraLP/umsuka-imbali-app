import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import type { MutationResult } from "@/lib/events/mutations";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole, ComponentType, Database, Workgroup } from "@/types/database.types";

/**
 * Audience segmentation for events (Sprint 18). An event can be shown to:
 * - everyone (`all`),
 * - one workgroup (`workgroup`),
 * - one member type / component (`member_type`),
 * - a concrete set of users (`specific_users`, rows in
 *   umsuka.event_audience_users).
 *
 * Module-cycle note: `schema.ts` imports `AUDIENCE_FORM_FIELDS` and
 * `audienceCrossFieldIssueFn` from this module at runtime, so this module
 * must NOT import runtime values from `schema.ts` (the workgroup enum is
 * mirrored locally in `AUDIENCE_WORKGROUPS`). Only type-only imports are
 * used here otherwise.
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

interface AudienceFieldsData {
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
    eventId: z.string().uuid("eventId must be a valid UUID."),
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

// ── Server-side audience resolution (D3/D7) ─────────────

export interface AudienceResolutionInput {
  eventType?: string | null;
  audienceType?: AudienceTypeValue | null;
  audienceWorkgroup?: string | null;
  audienceMemberType?: string | null;
  audienceUserIds?: string[];
}

export interface ResolvedAudience {
  audienceType: AudienceTypeValue;
  audienceWorkgroup: Workgroup | null;
  audienceMemberType: AudienceMemberType | null;
  audienceUserIds: string[];
}

export type ResolveAudienceResult =
  | { success: false; error: string }
  | { success: true; audience: ResolvedAudience };

/**
 * Resolves the audience fields submitted with an event (create/update)
 * into the canonical values stored on umsuka.events (D3/D7):
 * - work_shift events ALWAYS resolve to ('all', null, null, []) — the
 *   audience section is not available for them; a tampered request that
 *   submits any non-default audience is rejected.
 * - non-work_shift events require a management actor (leads can only
 *   create work_shift events, but this is enforced here, not just in
 *   the caller).
 */
export function resolveAudienceFields(
  actor: { role: AppRole; isWorkgroupLead: boolean; workgroup: Workgroup },
  input: AudienceResolutionInput,
): ResolveAudienceResult {
  if (input.eventType === "work_shift") {
    const submittedNonDefaultAudience =
      (input.audienceType ?? "all") !== "all" ||
      input.audienceWorkgroup != null ||
      input.audienceMemberType != null ||
      (input.audienceUserIds ?? []).length > 0;

    if (submittedNonDefaultAudience) {
      return {
        success: false,
        error: "Los eventos de trabajo solo pueden mostrarse a su grupo de trabajo.",
      };
    }

    return {
      success: true,
      audience: {
        audienceType: "all",
        audienceWorkgroup: null,
        audienceMemberType: null,
        audienceUserIds: [],
      },
    };
  }

  if (!isManagementRole(actor.role)) {
    return {
      success: false,
      error: "Solo la gestión puede elegir la audiencia de un evento.",
    };
  }

  const audienceType = input.audienceType ?? "all";

  switch (audienceType) {
    case "all":
      return {
        success: true,
        audience: {
          audienceType: "all",
          audienceWorkgroup: null,
          audienceMemberType: null,
          audienceUserIds: [],
        },
      };
    case "workgroup":
      if (input.audienceWorkgroup === null) {
        return {
          success: false,
          error: "Debes elegir el grupo de trabajo al que se muestra el evento.",
        };
      }
      return {
        success: true,
        audience: {
          audienceType: "workgroup",
          audienceWorkgroup: input.audienceWorkgroup as Workgroup,
          audienceMemberType: null,
          audienceUserIds: [],
        },
      };
    case "member_type":
      if (input.audienceMemberType === null) {
        return {
          success: false,
          error: "Debes elegir el tipo de miembro al que se muestra el evento.",
        };
      }
      return {
        success: true,
        audience: {
          audienceType: "member_type",
          audienceWorkgroup: null,
          audienceMemberType: input.audienceMemberType as AudienceMemberType,
          audienceUserIds: [],
        },
      };
    case "specific_users":
      if (input.audienceUserIds === undefined || input.audienceUserIds.length === 0) {
        return {
          success: false,
          error: "Debes seleccionar al menos un usuario.",
        };
      }
      return {
        success: true,
        audience: {
          audienceType: "specific_users",
          audienceWorkgroup: null,
          audienceMemberType: null,
          audienceUserIds: input.audienceUserIds,
        },
      };
    default:
      return { success: false, error: "Tipo de audiencia no válido." };
  }
}

// ── DB helpers (authenticated client, RLS-driven) ───────

/**
 * Replaces the concrete audience rows of an event: deletes every row and
 * inserts the new set (only when non-empty). RLS restricts both operations
 * to management or the event creator, so the caller must be one of them.
 * Returns an error string on failure, `null` on success.
 */
export async function replaceAudienceUsers(eventId: string, userIds: string[]): Promise<string | null> {
  const supabase = await createClient();

  const { error: deleteError } = await supabase
    .from("event_audience_users")
    .delete()
    .eq("event_id", eventId);

  if (deleteError) {
    return `No se pudo actualizar la audiencia del evento: ${deleteError.message}`;
  }

  if (userIds.length === 0) {
    return null;
  }

  const { error: insertError } = await supabase
    .from("event_audience_users")
    .insert(userIds.map((userId) => ({ event_id: eventId, user_id: userId })));

  if (insertError) {
    return `No se pudo actualizar la audiencia del evento: ${insertError.message}`;
  }

  return null;
}

/**
 * Event ids the viewer is a concrete audience member of (their own rows
 * in event_audience_users — the RLS own-row clause, D4). Used by the
 * feed mirror (`listEvents`/`getEventById`) to emulate the events
 * SELECT policy audience branch through the authenticated client.
 */
export async function getMyAudienceEventIds(
  userId: string,
  client?: SupabaseClient<Database, "umsuka">,
): Promise<Set<string>> {
  const supabase = client ?? (await createClient());

  const { data, error } = await supabase
    .from("event_audience_users")
    .select("event_id")
    .eq("user_id", userId);

  if (error) {
    throw new Error(`Failed to fetch audience events for user ${userId}: ${error.message}`);
  }

  return new Set((data ?? []).map((row) => row.event_id));
}

// ── Queries ────────────────────────────────────────────

export interface AudienceUser {
  id: string;
  firstName: string;
  lastName: string;
  username: string | null;
}

/**
 * Users an event audience is concretely directed to (specific_users),
 * enriched with profile names via a second query + Map merge (same
 * pattern as getEventComments).
 */
export async function getEventAudienceUsers(eventId: string): Promise<AudienceUser[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_audience_users")
    .select("user_id")
    .eq("event_id", eventId);

  if (error) {
    throw new Error(`Failed to fetch audience users for event ${eventId}: ${error.message}`);
  }

  const userIds = [...new Set((data ?? []).map((row) => row.user_id))];
  const profilesById = new Map<string, {
    first_name: string;
    last_name: string;
    username: string | null;
  }>();

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name, username")
      .in("id", userIds);

    if (profilesError) {
      throw new Error(`Failed to fetch audience user profiles: ${profilesError.message}`);
    }

    for (const profile of profiles ?? []) {
      profilesById.set(profile.id, {
        first_name: profile.first_name,
        last_name: profile.last_name,
        username: profile.username,
      });
    }
  }

  return userIds.map((id) => {
    const profile = profilesById.get(id);
    return {
      id,
      firstName: profile?.first_name ?? "Miembro",
      lastName: profile?.last_name ?? "",
      username: profile?.username ?? null,
    };
  });
}

export interface AudienceMemberOption {
  id: string;
  firstName: string;
  lastName: string;
  username: string | null;
  workgroup: Workgroup;
  componentType: ComponentType;
}

/**
 * Active members (profiles with status = 'active') available for the
 * specific_users multi-select (pattern of getAvailableMembers in
 * shifts/queries.ts).
 */
export async function getAudienceOptions(): Promise<AudienceMemberOption[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, username, workgroup, component_type")
    .eq("status", "active")
    .order("first_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch audience options: ${error.message}`);
  }

  return (data ?? []).map((profile) => ({
    id: profile.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    username: profile.username ?? null,
    workgroup: profile.workgroup ?? "ninguno",
    componentType: profile.component_type,
  }));
}

/**
 * Number of concrete users per event (specific_users badge counts),
 * fetched in ONE batched query.
 */
export async function getAudienceUserCounts(eventIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (eventIds.length === 0) {
    return counts;
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_audience_users")
    .select("event_id")
    .in("event_id", eventIds);

  if (error) {
    throw new Error(`Failed to fetch audience user counts: ${error.message}`);
  }

  for (const row of data ?? []) {
    counts.set(row.event_id, (counts.get(row.event_id) ?? 0) + 1);
  }

  return counts;
}

export interface EventAudience {
  audienceType: AudienceTypeValue;
  audienceWorkgroup: Workgroup | null;
  audienceMemberType: AudienceMemberType | null;
  users: AudienceUser[];
}

/**
 * Full audience configuration of an event (type + companion values +
 * resolved users). Only meaningful for management/creators — the RLS
 * SELECT policies gate the reads.
 */
export async function getEventAudience(eventId: string): Promise<EventAudience | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("events")
    .select("audience_type, audience_workgroup, audience_member_type")
    .eq("id", eventId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch audience for event ${eventId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  const users = await getEventAudienceUsers(eventId);

  return {
    audienceType: data.audience_type,
    audienceWorkgroup: data.audience_workgroup,
    audienceMemberType: data.audience_member_type,
    users,
  };
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

// ── Mutation ───────────────────────────────────────────

/**
 * Reconfigures the audience of an existing non-work_shift event
 * (authz: management or the event creator; work_shift is rejected — its
 * audience is pinned to the workgroup).
 */
export async function updateEventAudience(
  input: UpdateEventAudienceInput,
): Promise<MutationResult> {
  const parsed = updateEventAudienceSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("events")
    .select("created_by, event_type")
    .eq("id", parsed.data.eventId)
    .maybeSingle();

  if (!existing) {
    return { success: false, error: "Evento no encontrado." };
  }

  if (existing.event_type === "work_shift") {
    return {
      success: false,
      error: "Los eventos de trabajo solo pueden mostrarse a su grupo de trabajo.",
    };
  }

  if (!isManagementRole(actor.role) && existing.created_by !== actor.id) {
    return {
      success: false,
      error: "No tienes permiso para modificar la audiencia de este evento.",
    };
  }

  const resolution = resolveAudienceFields(actor, {
    eventType: existing.event_type,
    ...parsed.data,
  });
  if (!resolution.success) {
    return resolution;
  }
  const { audience } = resolution;

  const { error: updateError } = await supabase
    .from("events")
    .update({
      audience_type: audience.audienceType,
      audience_workgroup: audience.audienceWorkgroup,
      audience_member_type: audience.audienceMemberType,
    })
    .eq("id", parsed.data.eventId);

  if (updateError) {
    return { success: false, error: updateError.message };
  }

  const audienceError = await replaceAudienceUsers(parsed.data.eventId, audience.audienceUserIds);
  if (audienceError) {
    return { success: false, error: audienceError };
  }

  return { success: true };
}