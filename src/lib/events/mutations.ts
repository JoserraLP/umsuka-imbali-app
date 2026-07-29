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
export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
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

  // For work_shift events, allow the creator (lead) or management to update
  if (parsed.data.eventType === "work_shift") {
    const { data: existing } = await supabase
      .from("events")
      .select("created_by")
      .eq("id", parsed.data.id)
      .single();

    if (!existing || (existing.created_by !== actor.id && !isManagementRole(actor.role))) {
      return { success: false, error: "No tienes permiso para editar este evento." };
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

  const actor = await requireAuthenticatedProfile();

  // For work_shift events, allow the creator (lead) or management to delete
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
    if (existing.created_by !== actor.id && !isManagementRole(actor.role)) {
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
