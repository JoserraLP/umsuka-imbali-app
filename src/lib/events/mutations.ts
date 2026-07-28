import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { requireManagement, AuthorizationError } from "@/lib/auth/permissions";
import {
  createEventSchema,
  updateEventSchema,
  deleteEventSchema,
  type CreateEventInput,
  type UpdateEventInput,
  type DeleteEventInput,
} from "@/lib/events/schema";
import type { AuthenticatedProfile } from "@/types/auth";

export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
}

/**
 * Resolves the current authenticated profile and enforces the
 * management-role gate in one place. Returns the profile on success, or
 * a MutationResult describing the authorization failure — callers use
 * `"success" in result` to distinguish the two without a try/catch at
 * every call site.
 */
async function assertCanManageEvents(): Promise<AuthenticatedProfile | MutationResult> {
  const actor = await requireAuthenticatedProfile();
  try {
    requireManagement(actor.role);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { success: false, error: err.message };
    }
    throw err;
  }
  return actor;
}

export async function createEvent(input: CreateEventInput): Promise<MutationResult> {
  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actorOrError = await assertCanManageEvents();
  if ("success" in actorOrError) {
    return actorOrError;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description,
      event_type: parsed.data.eventType,
      event_date: parsed.data.eventDate,
      capacity: parsed.data.capacity,
      created_by: actorOrError.id,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, id: data.id };
}

export async function updateEvent(input: UpdateEventInput): Promise<MutationResult> {
  const parsed = updateEventSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actorOrError = await assertCanManageEvents();
  if ("success" in actorOrError) {
    return actorOrError;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("events")
    .update({
      title: parsed.data.title,
      description: parsed.data.description,
      event_type: parsed.data.eventType,
      event_date: parsed.data.eventDate,
      capacity: parsed.data.capacity,
    })
    .eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function deleteEvent(input: DeleteEventInput): Promise<MutationResult> {
  const parsed = deleteEventSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actorOrError = await assertCanManageEvents();
  if ("success" in actorOrError) {
    return actorOrError;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("events").delete().eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
