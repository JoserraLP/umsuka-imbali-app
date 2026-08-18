import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { requireManagement, AuthorizationError } from "@/lib/auth/permissions";
import { getAllActiveMemberIds, notifyUsers } from "@/lib/notifications/emit";
import type { AuthenticatedProfile } from "@/types/auth";
import {
  createNewsSchema,
  updateNewsSchema,
  deleteNewsSchema,
  togglePinSchema,
  type CreateNewsInput,
  type UpdateNewsInput,
  type DeleteNewsInput,
  type TogglePinInput,
} from "@/lib/news/schema";

export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
}

// ── Authorization helpers ─────────────────────────────

/**
 * Asserts the current user has management role.
 * Returns the authenticated profile on success, or an error result if not authorized.
 */
async function assertManagement(): Promise<AuthenticatedProfile | MutationResult> {
  const actor = await requireAuthenticatedProfile();
  try {
    requireManagement(actor.role);
    return actor;
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { success: false, error: err.message };
    }
    throw err;
  }
}

// ── Mutations ─────────────────────────────────────────

/**
 * Creates a new news item.
 */
export async function createNews(input: CreateNewsInput): Promise<MutationResult> {
  const parsed = createNewsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const authResult = await assertManagement();
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("news")
    .insert({
      title: parsed.data.title,
      content: parsed.data.content,
      image_url: parsed.data.image_url,
      published: parsed.data.published,
      pinned: parsed.data.pinned,
      created_by: authResult.id,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  // Sprint 20: notify every active member only when the news is actually
  // published (drafts are silent). Best-effort — a notification failure,
  // even an unexpected throw from the emitter, can never fail the create.
  if (parsed.data.published) {
    try {
      await notifyUsers({
        userIds: await getAllActiveMemberIds(),
        type: "news_created",
        title: `Nueva noticia: ${parsed.data.title}`,
        message: undefined,
        link: `/news/${data.id}`,
      });
    } catch (err) {
      console.error("createNews: la notificación falló (no bloqueante):", err);
    }
  }

  return { success: true, id: data.id };
}

/**
 * Updates an existing news item.
 */
export async function updateNews(input: UpdateNewsInput): Promise<MutationResult> {
  const parsed = updateNewsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const authResult = await assertManagement();
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("news")
    .update({
      title: parsed.data.title,
      content: parsed.data.content,
      image_url: parsed.data.image_url,
      published: parsed.data.published,
      pinned: parsed.data.pinned,
    })
    .eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Deletes a news item.
 */
export async function deleteNews(input: DeleteNewsInput): Promise<MutationResult> {
  const parsed = deleteNewsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const authResult = await assertManagement();
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();
  const { error } = await supabase.from("news").delete().eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Toggles the pinned status of a news item.
 */
export async function togglePin(input: TogglePinInput): Promise<MutationResult> {
  const parsed = togglePinSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const authResult = await assertManagement();
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  // First fetch the current pinned value
  const { data: current, error: fetchError } = await supabase
    .from("news")
    .select("pinned")
    .eq("id", parsed.data.id)
    .single();

  if (fetchError || !current) {
    return { success: false, error: "Noticia no encontrada." };
  }

  const { error } = await supabase
    .from("news")
    .update({ pinned: !current.pinned })
    .eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
