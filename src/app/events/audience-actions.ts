"use server";

import { revalidatePath } from "next/cache";
import { createEventWithAudience } from "@/lib/events/mutations";
import { updateEventAudience } from "@/lib/events/audience";
import { getVisibleEvents } from "@/lib/events/queries";
import type { CreateEventInput } from "@/lib/events/schema";
import type { UpdateEventAudienceInput } from "@/lib/events/audience";
import type { EventListItem, EventVisibility, ListEventsOptions } from "@/lib/events/queries";
import type { MutationResult } from "@/lib/events/mutations";

/**
 * Sprint 18 server actions. The create form uses
 * createEventWithAudienceAction (createEventWithAudience is the
 * documented alias of createEvent); createEventAction/updateEventAction
 * in actions.ts remain exported for the legacy paths.
 */

export async function createEventWithAudienceAction(
  input: CreateEventInput,
): Promise<MutationResult> {
  const result = await createEventWithAudience(input);

  if (result.success) {
    revalidatePath("/events");
    revalidatePath("/calendar");
  }

  return result;
}

export async function updateEventAudienceAction(
  input: UpdateEventAudienceInput,
): Promise<MutationResult> {
  const result = await updateEventAudience(input);

  if (result.success) {
    revalidatePath("/events");
    revalidatePath(`/events/${input.eventId}`);
    revalidatePath("/calendar");
  }

  return result;
}

/** Audience-aware feed query (no revalidation — read-only). */
export async function getVisibleEventsAction(
  options: ListEventsOptions = {},
  visibility?: EventVisibility,
): Promise<EventListItem[]> {
  return getVisibleEvents(options, visibility);
}
