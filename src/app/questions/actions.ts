"use server";

import { revalidatePath } from "next/cache";
import {
  createQuestion,
  updateQuestion,
  deleteQuestion,
  resolveQuestion,
  addComment,
} from "@/lib/questions/mutations";
import type {
  CreateQuestionInput,
  UpdateQuestionInput,
  DeleteQuestionInput,
  ResolveQuestionInput,
  AddCommentInput,
} from "@/lib/questions/schema";
import type { MutationResult } from "@/lib/questions/mutations";

export async function createQuestionAction(
  input: CreateQuestionInput,
): Promise<MutationResult> {
  const result = await createQuestion(input);

  if (result.success) {
    revalidatePath("/questions");
  }

  return result;
}

export async function updateQuestionAction(
  input: UpdateQuestionInput,
): Promise<MutationResult> {
  const result = await updateQuestion(input);

  if (result.success) {
    revalidatePath("/questions");
    revalidatePath(`/questions/${input.id}`);
  }

  return result;
}

export async function deleteQuestionAction(
  input: DeleteQuestionInput,
): Promise<MutationResult> {
  const result = await deleteQuestion(input);

  if (result.success) {
    revalidatePath("/questions");
  }

  return result;
}

export async function resolveQuestionAction(
  input: ResolveQuestionInput,
): Promise<MutationResult> {
  const result = await resolveQuestion(input);

  if (result.success) {
    revalidatePath("/questions");
    revalidatePath(`/questions/${input.id}`);
  }

  return result;
}

export async function addCommentAction(
  input: AddCommentInput,
): Promise<MutationResult> {
  const result = await addComment(input);

  if (result.success) {
    revalidatePath(`/questions/${input.question_id}`);
  }

  return result;
}
