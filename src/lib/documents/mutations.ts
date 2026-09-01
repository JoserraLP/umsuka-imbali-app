import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import {
  createCategorySchema,
  updateCategorySchema,
  deleteCategorySchema,
  createDocumentSchema,
  updateDocumentSchema,
  deleteDocumentSchema,
  validateDocumentFile,
  inferMimeFromExtension,
  ALLOWED_MIME_TYPES,
} from "@/lib/documents/schema";

export type MutationResult<T = unknown> = { success: true; data: T } | { success: false; error: string };

function requireManagementGuard(profile: Awaited<ReturnType<typeof getCurrentProfile>>): MutationResult<never> | null {
  if (!profile) return { success: false, error: "No autenticado." };
  if (!isManagementRole(profile.role as never)) {
    return { success: false, error: "Solo la directiva puede gestionar documentos." };
  }
  return null;
}

export async function createCategory(input: {
  name: string;
  description?: string | null;
  parentId?: string | null;
}): Promise<MutationResult<{ id: string }>> {
  const profile = await getCurrentProfile();
  const guard = requireManagementGuard(profile);
  if (guard) return guard as MutationResult<never>;

  const parsed = createCategorySchema.safeParse({
    name: input.name,
    description: input.description ?? null,
    parentId: input.parentId ?? null,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_categories")
    .insert({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      parent_id: parsed.data.parentId ?? null,
      created_by: profile!.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { success: false, error: "Ya existe una categoría con ese nombre." };
    return { success: false, error: error.message };
  }

  return { success: true, data: { id: data.id } };
}

export async function updateCategory(input: {
  id: string;
  name: string;
  description?: string | null;
  parentId?: string | null;
}): Promise<MutationResult> {
  const profile = await getCurrentProfile();
  const guard = requireManagementGuard(profile);
  if (guard) return guard;

  const parsed = updateCategorySchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("document_categories")
    .update({
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      parent_id: parsed.data.parentId ?? null,
    })
    .eq("id", parsed.data.id);

  if (error) {
    if (error.code === "23505") return { success: false, error: "Ya existe una categoría con ese nombre." };
    return { success: false, error: error.message };
  }

  return { success: true, data: null };
}

export async function deleteCategory(id: string): Promise<MutationResult> {
  const profile = await getCurrentProfile();
  const guard = requireManagementGuard(profile);
  if (guard) return guard;

  const parsed = deleteCategorySchema.safeParse({ id });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  const supabase = await createClient();
  const { error } = await supabase.from("document_categories").delete().eq("id", parsed.data.id);
  if (error) return { success: false, error: error.message };
  return { success: true, data: null };
}

export async function createDocument(input: {
  name: string;
  categoryId?: string | null;
  file: File;
}): Promise<MutationResult<{ id: string }>> {
  const profile = await getCurrentProfile();
  const guard = requireManagementGuard(profile);
  if (guard) return guard as MutationResult<never>;

  if (!input.file || input.file.size === 0) {
    return { success: false, error: "Fichero no especificado." };
  }

  const validation = validateDocumentFile({ name: input.file.name, size: input.file.size, type: input.file.type });
  if (!validation.valid) return { success: false, error: validation.error ?? "Fichero no válido." };

  const mimeType = inferMimeFromExtension(input.file.name, input.file.type) as (typeof ALLOWED_MIME_TYPES)[number];
  if (!(ALLOWED_MIME_TYPES as readonly string[]).includes(mimeType)) {
    return { success: false, error: "Tipo de fichero no permitido." };
  }

  // Validate name/category via Zod (without file fields)
  const parsedMeta = createDocumentSchema.safeParse({
    name: input.name,
    categoryId: input.categoryId ?? null,
    filePath: "placeholder",
    fileSize: input.file.size,
    mimeType,
  });
  if (!parsedMeta.success) {
    return { success: false, error: parsedMeta.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const ext = input.file.name.split(".").pop() ?? "bin";
  const filePath = `${profile!.id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage.from("documents").upload(filePath, input.file, {
    contentType: mimeType,
    upsert: false,
  });

  if (uploadError) return { success: false, error: `Error al subir fichero: ${uploadError.message}` };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .insert({
      category_id: parsedMeta.data.categoryId ?? null,
      name: parsedMeta.data.name,
      file_path: filePath,
      file_size: input.file.size,
      mime_type: mimeType,
      uploaded_by: profile!.id,
    })
    .select("id")
    .single();

  if (error) {
    // cleanup orphan file
    try {
      await admin.storage.from("documents").remove([filePath]);
    } catch {
      // ignore
    }
    if (error.code === "23505") return { success: false, error: "Ya existe un documento con esa ruta." };
    return { success: false, error: error.message };
  }

  return { success: true, data: { id: data.id } };
}

export async function updateDocument(input: { id: string; name: string; categoryId?: string | null }): Promise<MutationResult> {
  const profile = await getCurrentProfile();
  const guard = requireManagementGuard(profile);
  if (guard) return guard;

  const parsed = updateDocumentSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("documents")
    .update({
      name: parsed.data.name,
      category_id: parsed.data.categoryId ?? null,
    })
    .eq("id", parsed.data.id);

  if (error) return { success: false, error: error.message };
  return { success: true, data: null };
}

export async function deleteDocument(id: string): Promise<MutationResult> {
  const profile = await getCurrentProfile();
  const guard = requireManagementGuard(profile);
  if (guard) return guard;

  const parsed = deleteDocumentSchema.safeParse({ id });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("documents")
    .select("file_path")
    .eq("id", parsed.data.id)
    .maybeSingle();

  const { error } = await supabase.from("documents").delete().eq("id", parsed.data.id);
  if (error) return { success: false, error: error.message };

  if (existing?.file_path) {
    try {
      const admin = createAdminClient();
      await admin.storage.from("documents").remove([existing.file_path]);
    } catch {
      // ignore
    }
  }

  return { success: true, data: null };
}
