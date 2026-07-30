"use server";

import { revalidatePath } from "next/cache";
import {
  createNews,
  updateNews,
  deleteNews,
  togglePin,
} from "@/lib/news/mutations";
import type {
  CreateNewsInput,
  UpdateNewsInput,
  DeleteNewsInput,
  TogglePinInput,
} from "@/lib/news/schema";
import type { MutationResult } from "@/lib/news/mutations";

export async function createNewsAction(input: CreateNewsInput): Promise<MutationResult> {
  const result = await createNews(input);

  if (result.success) {
    revalidatePath("/news");
  }

  return result;
}

export async function updateNewsAction(input: UpdateNewsInput): Promise<MutationResult> {
  const result = await updateNews(input);

  if (result.success) {
    revalidatePath("/news");
    revalidatePath(`/news/${input.id}`);
  }

  return result;
}

export async function deleteNewsAction(input: DeleteNewsInput): Promise<MutationResult> {
  const result = await deleteNews(input);

  if (result.success) {
    revalidatePath("/news");
  }

  return result;
}

export async function togglePinAction(input: TogglePinInput): Promise<MutationResult> {
  const result = await togglePin(input);

  if (result.success) {
    revalidatePath("/news");
    revalidatePath(`/news/${input.id}`);
  }

  return result;
}
