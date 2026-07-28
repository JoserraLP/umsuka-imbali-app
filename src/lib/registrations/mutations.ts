import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import {
  registerForEventSchema,
  unregisterFromEventSchema,
  type RegisterForEventInput,
  type UnregisterFromEventInput,
} from "@/lib/registrations/schema";

export interface MutationResult {
  success: boolean;
  error?: string;
}

/** Postgres unique_violation error code, raised on a duplicate (event_id, user_id) registration. */
const UNIQUE_VIOLATION = "23505";

export async function registerForEvent(input: RegisterForEventInput): Promise<MutationResult> {
  const parsed = registerForEventSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("event_registrations")
    .insert({ event_id: parsed.data.eventId, user_id: actor.id });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { success: false, error: "Ya estás inscrito en este evento." };
    }
    // Raised by umsuka.check_event_capacity() when the event is full.
    if (error.message.toLowerCase().includes("capacity")) {
      return { success: false, error: "No quedan plazas disponibles para este evento." };
    }
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Unregisters a member from an event. If `userId` is omitted, the actor
 * unregisters themselves. Removing a *different* member's registration
 * is only permitted for management roles — checked here server-side,
 * never trusted from the client (RLS enforces the same rule as a
 * backstop: delete is allowed for `user_id = auth.uid() or is_management()`).
 */
export async function unregisterFromEvent(input: UnregisterFromEventInput): Promise<MutationResult> {
  const parsed = unregisterFromEventSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();
  const targetUserId = parsed.data.userId ?? actor.id;

  if (targetUserId !== actor.id && !isManagementRole(actor.role)) {
    return { success: false, error: "No tienes permiso para dar de baja a otro miembro." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("event_registrations")
    .delete()
    .eq("event_id", parsed.data.eventId)
    .eq("user_id", targetUserId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
