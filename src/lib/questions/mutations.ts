import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { AuthorizationError } from "@/lib/auth/permissions";
import type { AuthenticatedProfile } from "@/types/auth";
import {
  createQuestionSchema,
  updateQuestionSchema,
  deleteQuestionSchema,
  resolveQuestionSchema,
  addCommentSchema,
  type CreateQuestionInput,
  type UpdateQuestionInput,
  type DeleteQuestionInput,
  type ResolveQuestionInput,
  type AddCommentInput,
} from "@/lib/questions/schema";

export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
}

// ── Authorization helpers ─────────────────────────────

/**
 * Asserts the current user can modify a question.
 * Returns the authenticated profile on success, or an error result if not authorized.
 * Allowed: creator of the question OR any management role.
 */
async function assertCanModifyQuestion(
  questionId: string,
): Promise<AuthenticatedProfile | MutationResult> {
  const actor = await requireAuthenticatedProfile();

  // Management can modify any question
  if (isManagementRole(actor.role)) {
    return actor;
  }

  // Creator can modify their own question
  const supabase = await createClient();
  const { data: question, error } = await supabase
    .from("questions")
    .select("user_id")
    .eq("id", questionId)
    .single();

  if (error || !question) {
    return { success: false, error: "Pregunta no encontrada." };
  }

  if (question.user_id === actor.id) {
    return actor;
  }

  return {
    success: false,
    error: "No tienes permisos para modificar esta pregunta.",
  };
}

// ── Mutations ─────────────────────────────────────────

/**
 * Creates a new question. Any authenticated user can create.
 */
export async function createQuestion(
  input: CreateQuestionInput,
): Promise<MutationResult> {
  const parsed = createQuestionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const actor = await requireAuthenticatedProfile();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("questions")
    .insert({
      title: parsed.data.title,
      content: parsed.data.content,
      category: parsed.data.category,
      priority: parsed.data.priority,
      user_id: actor.id,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, id: data.id };
}

/**
 * Updates an existing question. Only creator or management can update.
 */
export async function updateQuestion(
  input: UpdateQuestionInput,
): Promise<MutationResult> {
  const parsed = updateQuestionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const authResult = await assertCanModifyQuestion(parsed.data.id);
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("questions")
    .update({
      title: parsed.data.title,
      content: parsed.data.content,
      category: parsed.data.category,
      priority: parsed.data.priority,
    })
    .eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Deletes a question. Only creator or management can delete.
 */
export async function deleteQuestion(
  input: DeleteQuestionInput,
): Promise<MutationResult> {
  const parsed = deleteQuestionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const authResult = await assertCanModifyQuestion(parsed.data.id);
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("questions")
    .delete()
    .eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Marks a question as resolved or re-opens it.
 * Only creator or management can toggle resolution.
 */
export async function resolveQuestion(
  input: ResolveQuestionInput,
): Promise<MutationResult> {
  const parsed = resolveQuestionSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const authResult = await assertCanModifyQuestion(parsed.data.id);
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("questions")
    .update({ resolved: parsed.data.resolved })
    .eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Adds a comment to a question. Any authenticated user can comment.
 */
export async function addComment(
  input: AddCommentInput,
): Promise<MutationResult> {
  const parsed = addCommentSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: parsed.error.issues.map((issue) => issue.message).join(", "),
    };
  }

  const actor = await requireAuthenticatedProfile();

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("question_comments")
    .insert({
      question_id: parsed.data.question_id,
      content: parsed.data.content,
      user_id: actor.id,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, id: data.id };
}
