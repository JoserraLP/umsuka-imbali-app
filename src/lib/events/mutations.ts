import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { requireManagement, AuthorizationError } from "@/lib/auth/permissions";
import {
  createEventSchema,
  updateEventSchema,
  deleteEventSchema,
  addEventCommentSchema,
  deleteEventCommentSchema,
  joinWaitlistSchema,
  leaveWaitlistSchema,
  setWaitlistEntryStatusSchema,
  removeWaitlistEntrySchema,
  type CreateEventInput,
  type UpdateEventInput,
  type DeleteEventInput,
  type AddEventCommentInput,
  type DeleteEventCommentInput,
  type JoinWaitlistInput,
  type LeaveWaitlistInput,
  type SetWaitlistEntryStatusInput,
  type RemoveWaitlistEntryInput,
} from "@/lib/events/schema";
import type { Workgroup, AppRole } from "@/types/database.types";
export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
  position?: number;
}

/** Postgres unique_violation error code (duplicate (event_id, user_id) row). */
const UNIQUE_VIOLATION = "23505";

/**
 * Resolves the target workgroup for a work_shift event.
 * Management can choose any active group; a workgroup lead can only use
 * their own group (the form already defaults to it, this is the server-side
 * enforcement so a lead cannot create events for another group).
 * Returns `{ success: false }` when the actor cannot pick that group.
 */
function resolveWorkShiftGroup(
  actor: { role: AppRole; isWorkgroupLead: boolean; workgroup: Workgroup },
  requestedGroup: Workgroup | null,
): { success: false; error: string } | { success: true; group: Workgroup } {
  if (isManagementRole(actor.role)) {
    return requestedGroup !== null
      ? { success: true, group: requestedGroup }
      : { success: false, error: "Debes elegir el grupo del evento de trabajo." };
  }

  if (!actor.isWorkgroupLead) {
    return {
      success: false,
      error: "Solo los responsables de grupo pueden crear eventos de tipo trabajo.",
    };
  }

  if (actor.workgroup === "ninguno" || requestedGroup !== actor.workgroup) {
    return {
      success: false,
      error: "Solo puedes crear eventos de tipo trabajo para tu propio grupo.",
    };
  }
  return { success: true, group: actor.workgroup };
}

export async function createEvent(input: CreateEventInput): Promise<MutationResult> {
  const parsed = createEventSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();

  // Workgroup leads can create work_shift events; management can create any event.
  if (parsed.data.eventType === "work_shift") {
    if (actor.role !== "super_admin" && !actor.isWorkgroupLead) {
      return {
        success: false,
        error: "Solo los responsables de grupo pueden crear eventos de tipo trabajo.",
      };
    }
  } else {
    try {
      requireManagement(actor.role);
    } catch (err) {
      if (err instanceof AuthorizationError) {
        return { success: false, error: err.message };
      }
      throw err;
    }
  }

  const group =
    parsed.data.eventType === "work_shift"
      ? resolveWorkShiftGroup(actor, parsed.data.workgroup)
      : null;

  if (group !== null && !group.success) {
    return group;
  }
  const resolvedGroup: Workgroup | null = group === null ? null : group.group;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description,
      event_type: parsed.data.eventType,
      event_date: parsed.data.eventDate,
      capacity: parsed.data.capacity,
      location: parsed.data.location,
      image_url: parsed.data.imageUrl,
      registration_deadline: parsed.data.registrationDeadline,
      created_by: actor.id,
      visible_to_group: resolvedGroup,
      created_by_workgroup: resolvedGroup,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  // Auto-create a default shift for work_shift events so the
  // workgroup attendance panel has a shift to reference.
  if (parsed.data.eventType === "work_shift" && data.id) {
    const eventDate = new Date(parsed.data.eventDate);
    const endDate = new Date(eventDate.getTime() + 4 * 60 * 60 * 1000); // +4 hours default

    const { error: shiftError } = await supabase.from("shifts").insert({
      event_id: data.id,
      name: parsed.data.title,
      start_time: eventDate.toISOString(),
      end_time: endDate.toISOString(),
      workgroup: resolvedGroup,
    });

    if (shiftError) {
      // Non-fatal: event was created, shift creation failed
      console.error("Failed to auto-create shift for work_shift event:", shiftError.message);
    }
  }

  return { success: true, id: data.id };
}

export async function updateEvent(input: UpdateEventInput): Promise<MutationResult> {
  const parsed = updateEventSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();
  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("events")
    .select("created_by, event_type")
    .eq("id", parsed.data.id)
    .single();

  if (!existing) {
    return { success: false, error: "Evento no encontrado." };
  }

  const isWorkShift = parsed.data.eventType === "work_shift";
  const wasWorkShift = existing.event_type === "work_shift";

  // Work_shift events: the creator (a workgroup lead) or management can
  // update them. A lead cannot convert their work_shift event into a
  // general one, and its group is pinned to the lead's own workgroup.
  let group: { success: false; error: string } | { success: true; group: Workgroup } | null = null;
  if (wasWorkShift) {
    if (isManagementRole(actor.role)) {
      if (!isWorkShift) {
        return {
          success: false,
          error: "No puedes cambiar el tipo de un evento de tipo trabajo.",
        };
      }
      group = resolveWorkShiftGroup(actor, parsed.data.workgroup);
    } else if (existing.created_by !== actor.id || !actor.isWorkgroupLead) {
      return { success: false, error: "No tienes permiso para editar este evento." };
    } else if (!isWorkShift) {
      return { success: false, error: "No puedes cambiar el tipo de un evento de tipo trabajo." };
    } else {
      // Lead: group pinned to their own workgroup.
      group =
        actor.workgroup === "ninguno"
          ? { success: false, error: "Tu perfil no tiene un grupo de trabajo asignado." }
          : { success: true, group: actor.workgroup };
    }
  } else if (!isManagementRole(actor.role)) {
    try {
      requireManagement(actor.role);
    } catch (err) {
      if (err instanceof AuthorizationError) {
        return { success: false, error: err.message };
      }
      throw err;
    }
  } else if (isWorkShift) {
    group = resolveWorkShiftGroup(actor, parsed.data.workgroup);
  }

  if (group !== null && !group.success) {
    return group;
  }
  const resolvedGroup: Workgroup | null = group === null ? null : group.group;

  const { error } = await supabase
    .from("events")
    .update({
      title: parsed.data.title,
      description: parsed.data.description,
      event_type: parsed.data.eventType,
      event_date: parsed.data.eventDate,
      capacity: parsed.data.capacity,
      location: parsed.data.location,
      image_url: parsed.data.imageUrl,
      registration_deadline: parsed.data.registrationDeadline,
      visible_to_group: resolvedGroup,
      created_by_workgroup: resolvedGroup,
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

  const actor = await requireAuthenticatedProfile();

  // For work_shift events, allow the creating lead or management to delete
  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("events")
    .select("created_by, event_type")
    .eq("id", parsed.data.id)
    .single();

  if (!existing) {
    return { success: false, error: "Evento no encontrado." };
  }

  if (existing.event_type === "work_shift") {
    if (isManagementRole(actor.role)) {
      // management allowed
    } else if (existing.created_by !== actor.id || !actor.isWorkgroupLead) {
      return { success: false, error: "No tienes permiso para eliminar este evento." };
    }
  } else {
    try {
      requireManagement(actor.role);
    } catch (err) {
      if (err instanceof AuthorizationError) {
        return { success: false, error: err.message };
      }
      throw err;
    }
  }

  const { error } = await supabase.from("events").delete().eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ── Event comments ─────────────────────────────────────

/**
 * Adds a comment to an event, owned by the actor. The body is trimmed
 * and length-validated by addEventCommentSchema before any DB call.
 */
export async function addEventComment(input: AddEventCommentInput): Promise<MutationResult> {
  const parsed = addEventCommentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("event_comments")
    .insert({
      event_id: parsed.data.eventId,
      user_id: actor.id,
      body: parsed.data.body,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, id: data.id };
}

/**
 * Deletes an event comment. The author can always delete their own
 * comment; management can delete any comment (moderation). Mirrors the
 * event_comments_delete_own_or_management RLS policy.
 */
export async function deleteEventComment(input: DeleteEventCommentInput): Promise<MutationResult> {
  const parsed = deleteEventCommentSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();
  const supabase = await createClient();

  const { data: comment } = await supabase
    .from("event_comments")
    .select("user_id")
    .eq("id", parsed.data.commentId)
    .maybeSingle();

  if (!comment) {
    return { success: false, error: "Comentario no encontrado o ya eliminado." };
  }

  if (comment.user_id !== actor.id && !isManagementRole(actor.role)) {
    return { success: false, error: "No tienes permiso para eliminar este comentario." };
  }

  const { error } = await supabase.from("event_comments").delete().eq("id", parsed.data.commentId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

// ── Event waitlist ─────────────────────────────────────

/**
 * Adds the actor to the event's waitlist. A waitlist seat only makes
 * sense for a full or closed event, so the event row (capacity +
 * registration_deadline) and the current registration count are read
 * first (same pattern as registerForEvent): when the event still has
 * free places and the deadline has not passed, the member is asked to
 * register directly instead of queueing. The position is assigned by
 * the assign_waitlist_position() DB trigger (max(position)+1 while
 * holding the event row lock), so concurrent joins stay race-safe, and
 * returned here so the UI can show "posición #N" right away.
 */
export async function joinWaitlist(input: JoinWaitlistInput): Promise<MutationResult> {
  const parsed = joinWaitlistSchema.safeParse(input);
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

  if (!isFull && !isDeadlinePassed) {
    return { success: false, error: "El evento tiene plazas disponibles. Apúntate directamente." };
  }

  const { data, error } = await supabase
    .from("event_waitlist")
    .insert({
      event_id: parsed.data.eventId,
      user_id: actor.id,
    })
    .select("position")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { success: false, error: "Ya estás en la lista de espera." };
    }
    return { success: false, error: error.message };
  }

  return { success: true, position: data.position };
}

/**
 * Removes the actor's own waitlist entry. The renumber_waitlist_after_delete()
 * DB trigger shifts every later position down by one.
 */
export async function leaveWaitlist(input: LeaveWaitlistInput): Promise<MutationResult> {
  const parsed = leaveWaitlistSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();
  const supabase = await createClient();

  const { error } = await supabase
    .from("event_waitlist")
    .delete()
    .eq("event_id", parsed.data.eventId)
    .eq("user_id", actor.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Management-only: changes a waitlist entry's status. Promoting an entry
 * creates the real registration first (event_registrations) and only
 * marks the entry as promoted afterwards; any other status only touches
 * the entry itself. Promotion is allowed even after the registration
 * deadline has passed (decision #2).
 */
export async function setWaitlistEntryStatus(
  input: SetWaitlistEntryStatusInput,
): Promise<MutationResult> {
  const parsed = setWaitlistEntryStatusSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();

  if (!isManagementRole(actor.role)) {
    return { success: false, error: "No tienes permiso para gestionar la lista de espera." };
  }

  const supabase = await createClient();

  if (parsed.data.status === "promoted") {
    const { data: entry } = await supabase
      .from("event_waitlist")
      .select("user_id")
      .eq("id", parsed.data.entryId)
      .maybeSingle();

    if (!entry) {
      return { success: false, error: "La entrada de la lista de espera no existe." };
    }

    const { error: registrationError } = await supabase
      .from("event_registrations")
      .insert({ event_id: parsed.data.eventId, user_id: entry.user_id });

    if (registrationError) {
      if (registrationError.code === UNIQUE_VIOLATION) {
        return { success: false, error: "Ese miembro ya está inscrito en el evento." };
      }
      return { success: false, error: registrationError.message };
    }
  }

  const { error } = await supabase
    .from("event_waitlist")
    .update({
      status: parsed.data.status,
      promoted_at: parsed.data.status === "promoted" ? new Date().toISOString() : null,
    })
    .eq("id", parsed.data.entryId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Management-only: deletes a waitlist entry outright (the DB trigger
 * renumbers every later position). Used by the "Quitar" action in the
 * management panel, distinct from leaveWaitlist (self-service).
 */
export async function removeWaitlistEntry(
  input: RemoveWaitlistEntryInput,
): Promise<MutationResult> {
  const parsed = removeWaitlistEntrySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();

  if (!isManagementRole(actor.role)) {
    return { success: false, error: "No tienes permiso para gestionar la lista de espera." };
  }

  const supabase = await createClient();

  const { error } = await supabase.from("event_waitlist").delete().eq("id", parsed.data.entryId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Promotes the first `freeSlots` waiting members (FIFO by position, then
 * joined_at) to real registrations. Uses the service-role client because
 * a member's own "unregister" must still be able to hand their freed spot
 * to the next waiting member. A per-entry failure (event already full,
 * duplicate registration, ...) is logged and skipped so one bad entry
 * never breaks the whole cascade.
 *
 * Pre-deadline promotion is granted by decision #2; only the current
 * capacity is checked here.
 *
 * @returns the number of members promoted.
 */
export async function promoteNextFromWaitlist(eventId: string): Promise<number> {
  const admin = createAdminClient();

  const { data: event } = await admin
    .from("events")
    .select("capacity")
    .eq("id", eventId)
    .maybeSingle();

  if (!event) return 0;

  const { count: registeredCount } = await admin
    .from("event_registrations")
    .select("*", { count: "exact", head: true })
    .eq("event_id", eventId);

  const capacity = event.capacity ?? null;
  if (capacity === null) return 0;

  const freeSlots = capacity - (registeredCount ?? 0);
  if (freeSlots <= 0) return 0;

  const { data: waiting } = await admin
    .from("event_waitlist")
    .select("id, user_id")
    .eq("status", "waiting")
    .order("position", { ascending: true })
    .order("joined_at", { ascending: true });

  // No .limit() in the test chain-builder: cap the window in JS instead.
  const candidates = (waiting ?? []).slice(0, freeSlots);

  let promoted = 0;

  for (const entry of candidates) {
    const { error: registrationError } = await admin
      .from("event_registrations")
      .insert({ event_id: eventId, user_id: entry.user_id });

    if (registrationError) {
      // Another promotion (or a direct registration) filled the spot, or
      // this member is already registered — skip and keep going.
      console.error(
        `promoteNextFromWaitlist: skip entry ${entry.id} (${registrationError.message})`,
      );
      continue;
    }

    const { error: updateError } = await admin
      .from("event_waitlist")
      .update({
        status: "promoted",
        promoted_at: new Date().toISOString(),
      })
      .eq("id", entry.id);

    if (updateError) {
      console.error(
        `promoteNextFromWaitlist: entry ${entry.id} registered but not marked promoted (${updateError.message})`,
      );
    }

    promoted += 1;
  }

  return promoted;
}
