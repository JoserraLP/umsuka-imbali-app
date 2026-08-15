import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { joinWaitlist, promoteNextFromWaitlist } from "@/lib/events/mutations";
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

/**
 * Result of registerForEvent: `status` distinguishes a real registration
 * from a waitlist fallback, and `position` reports the member's waitlist
 * position when `status === "waitlisted"`.
 */
export interface RegisterForEventResult {
  success: boolean;
  error?: string;
  status?: "registered" | "waitlisted";
  position?: number;
}

/** Postgres unique_violation error code, raised on a duplicate (event_id, user_id) registration. */
const UNIQUE_VIOLATION = "23505";

function isCapacityViolation(error: { message?: string }): boolean {
  return error.message?.toLowerCase().includes("capacity") ?? false;
}

/**
 * Registers a member for an event. The event row (capacity +
 * registration_deadline) is read first:
 *  - full event (count >= capacity) or passed deadline → the member joins
 *    the waitlist (joinWaitlist) and gets their position back.
 *  - otherwise → direct insert; a duplicate is a friendly "ya inscrito"
 *    error, and a mid-insert capacity violation (race with another
 *    concurrent registration) falls back to the waitlist instead of
 *    failing the request.
 */
export async function registerForEvent(
  input: RegisterForEventInput,
): Promise<RegisterForEventResult> {
  const parsed = registerForEventSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();
  const supabase = await createClient();

  const { data: event } = await supabase
    .from("events")
    .select("capacity, registration_deadline")
    .eq("id", parsed.data.eventId)
    .maybeSingle();

  if (!event) {
    return { success: false, error: "Evento no encontrado." };
  }

  const { count: registeredCount } = await supabase
    .from("event_registrations")
    .select("*", { count: "exact", head: true })
    .eq("event_id", parsed.data.eventId);

  const capacity = event.capacity ?? null;
  const deadline = event.registration_deadline ?? null;
  const isFull = capacity !== null && (registeredCount ?? 0) >= capacity;
  const isDeadlinePassed =
    deadline !== null && !Number.isNaN(Date.parse(deadline)) && Date.parse(deadline) <= Date.now();

  if (isFull || isDeadlinePassed) {
    const waitlistResult = await joinWaitlist({ eventId: parsed.data.eventId });

    if (!waitlistResult.success) {
      return { success: false, error: waitlistResult.error };
    }

    return { success: true, status: "waitlisted", position: waitlistResult.position };
  }

  const { error } = await supabase.from("event_registrations").insert({
    event_id: parsed.data.eventId,
    user_id: actor.id,
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { success: false, error: "Ya estás inscrito en este evento." };
    }
    // Raised by umsuka.check_event_capacity() when the event filled up
    // between our count and the insert (concurrent registration) — the
    // member lands on the waitlist instead of getting an error.
    if (isCapacityViolation(error)) {
      const waitlistResult = await joinWaitlist({ eventId: parsed.data.eventId });

      if (!waitlistResult.success) {
        return { success: false, error: waitlistResult.error };
      }

      return { success: true, status: "waitlisted", position: waitlistResult.position };
    }
    return { success: false, error: error.message };
  }

  return { success: true, status: "registered" };
}

/**
 * Unregisters a member from an event. If `userId` is omitted, the actor
 * unregisters themselves. Removing a *different* member's registration
 * is only permitted for management roles — checked here server-side,
 * never trusted from the client (RLS enforces the same rule as a
 * backstop: delete is allowed for `user_id = auth.uid() or is_management()`).
 *
 * After a successful unregistration the first waiting member is promoted
 * into the freed spot (promoteNextFromWaitlist). A promotion failure is
 * logged and never breaks the unregistration itself.
 */
export async function unregisterFromEvent(
  input: UnregisterFromEventInput,
): Promise<MutationResult> {
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

  try {
    await promoteNextFromWaitlist(parsed.data.eventId);
  } catch (promotionError) {
    // The unregistration succeeded; the freed spot will stay empty until
    // the next promotion attempt. Never fail the caller for this.
    console.error("unregisterFromEvent: falló la promoción de la lista de espera:", promotionError);
  }

  return { success: true };
}
