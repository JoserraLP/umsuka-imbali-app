import "server-only";
import { createClient } from "@/lib/supabase/server";

export interface DocumentCategoryRow {
  id: string;
  name: string;
  description: string | null;
  parentId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DocumentRow {
  id: string;
  categoryId: string | null;
  categoryName: string | null;
  name: string;
  filePath: string;
  fileSize: number;
  mimeType: string;
  uploadedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

function mapCategoryRow(row: {
  id: string;
  name: string;
  description: string | null;
  parent_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}): DocumentCategoryRow {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    parentId: row.parent_id,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDocumentRow(row: {
  id: string;
  category_id: string | null;
  name: string;
  file_path: string;
  file_size: number;
  mime_type: string;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
  document_categories?: { name: string } | null;
}): DocumentRow {
  return {
    id: row.id,
    categoryId: row.category_id,
    categoryName: (row.document_categories as { name: string } | null)?.name ?? null,
    name: row.name,
    filePath: row.file_path,
    fileSize: row.file_size,
    mimeType: row.mime_type,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getCategories(): Promise<DocumentCategoryRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_categories")
    .select("id, name, description, parent_id, created_by, created_at, updated_at")
    .order("name", { ascending: true });

  if (error) throw new Error(`Error al obtener categorías: ${error.message}`);
  return (data ?? []).map((r) => mapCategoryRow(r as never));
}

export async function getDocuments(options?: {
  search?: string;
  categoryId?: string;
  mimeType?: string;
}): Promise<DocumentRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("documents")
    .select("id, category_id, name, file_path, file_size, mime_type, uploaded_by, created_at, updated_at, document_categories(name)");

  if (options?.search) {
    query = query.ilike("name", `%${options.search}%`);
  }
  if (options?.categoryId) {
    query = query.eq("category_id", options.categoryId);
  }
  if (options?.mimeType) {
    query = query.eq("mime_type", options.mimeType);
  }

  query = query.order("created_at", { ascending: false });

  const { data, error } = await query;

  if (error) throw new Error(`Error al obtener documentos: ${error.message}`);
  return (data ?? []).map((r) => mapDocumentRow(r as never));
}

export async function getDocumentById(id: string): Promise<DocumentRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .select("id, category_id, name, file_path, file_size, mime_type, uploaded_by, created_at, updated_at, document_categories(name)")
    .eq("id", id)
    .maybeSingle();

  if (error) throw new Error(`Error al obtener documento: ${error.message}`);
  if (!data) return null;
  return mapDocumentRow(data as never);
}
