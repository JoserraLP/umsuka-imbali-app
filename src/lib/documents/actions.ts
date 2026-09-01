"use server";

import { revalidatePath } from "next/cache";
import {
  createCategory,
  deleteCategory,
  createDocument,
  updateDocument,
  deleteDocument,
} from "@/lib/documents/mutations";

export async function createDocumentCategoryAction(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const name = String(formData.get("name") ?? "");
  const description = formData.get("description") ? String(formData.get("description")) : null;
  const parentId = formData.get("parentId") ? String(formData.get("parentId")) : null;

  const result = await createCategory({ name, description, parentId });
  if (!result.success) return { success: false, error: result.error };
  revalidatePath("/documents");
  return { success: true };
}

export async function deleteDocumentCategoryAction(id: string): Promise<{ success: boolean; error?: string }> {
  const result = await deleteCategory(id);
  if (!result.success) return { success: false, error: result.error };
  revalidatePath("/documents");
  return { success: true };
}

export async function createDocumentAction(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const name = String(formData.get("name") ?? "");
  const categoryId = formData.get("categoryId") ? String(formData.get("categoryId")) : null;
  const file = formData.get("file") as File | null;

  if (!file) return { success: false, error: "Fichero no especificado." };

  const result = await createDocument({ name: name || file.name, categoryId, file });
  if (!result.success) return { success: false, error: result.error };
  revalidatePath("/documents");
  return { success: true };
}

export async function updateDocumentAction(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const id = String(formData.get("id") ?? "");
  const name = String(formData.get("name") ?? "");
  const categoryId = formData.get("categoryId") ? String(formData.get("categoryId")) : null;

  const result = await updateDocument({ id, name, categoryId });
  if (!result.success) return { success: false, error: result.error };
  revalidatePath("/documents");
  return { success: true };
}

export async function deleteDocumentAction(id: string): Promise<{ success: boolean; error?: string }> {
  const result = await deleteDocument(id);
  if (!result.success) return { success: false, error: result.error };
  revalidatePath("/documents");
  return { success: true };
}
