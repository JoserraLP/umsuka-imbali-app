import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import {
  updateEventAudienceSchema,
  type AudienceMemberOption,
  type AudienceMemberType,
  type AudienceTypeValue,
  type AudienceUser,
  type EventAudience,
  type UpdateEventAudienceInput,
} from "@/lib/events/audience-shared";
import type { MutationResult } from "@/lib/events/mutations";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppRole, Database, Workgroup } from "@/types/database.types";

/**
 * Server-side audience layer for events (Sprint 18): audience resolution,
 * DB helpers (RLS-driven through the authenticated client) and queries.
 *
 * The client-safe (isomorphic) part — constants, zod fields/schemas, pure
 * visibility mirror, labels — lives in `./audience-shared` and is
 * re-exported here so server modules (queries.ts, mutations.ts, pages,
 * actions) and tests can keep importing from `./audience`. Client
 * components must import from `./audience-shared` directly: this module
 * pulls in `next/headers`/`server-only` via the supabase and auth chains.
 */

export * from "./audience-shared";

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