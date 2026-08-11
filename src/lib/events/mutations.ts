import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { requireManagement, AuthorizationError } from "@/lib/auth/permissions";
import {
  createEventSchema,
  updateEventSchema,
  deleteEventSchema,
  type CreateEventInput,
  type UpdateEventInput,
  type DeleteEventInput,
} from "@/lib/events/schema";
import type { Workgroup, AppRole } from "@/types/database.types";
export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
}

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
