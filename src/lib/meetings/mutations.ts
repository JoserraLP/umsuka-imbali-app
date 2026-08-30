import "server-only";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { uploadMinutesSchema, deleteMinutesSchema } from "@/lib/meetings/schema";

export type MutationResult<T = unknown> = { success: true; data: T } | { success: false; error: string };

function requireManagementGuard(profile: Awaited<ReturnType<typeof getCurrentProfile>>): MutationResult<never> | null {
  if (!profile) return { success: false, error: "No autenticado." };
  if (!isManagementRole(profile.role as never)) {
    return { success: false, error: "Solo la directiva o super_admin pueden gestionar actas." };
  }
  return null;
}

/**
 * Upload/replace acta: file already uploaded to storage before calling,
 * this mutation only creates/replaces the meeting_minutes row.
 * Validates event is reunion, file constraints via Zod, then upserts.
 */
export async function uploadMinutes(input: {
  eventId: string;
  filePath: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
}): Promise<MutationResult> {
  const profile = await getCurrentProfile();
  const guard = requireManagementGuard(profile);
  if (guard) return guard;

  const parsed = uploadMinutesSchema.safeParse({
    eventId: input.eventId,
    filePath: input.filePath,
    fileName: input.fileName,
    fileSize: input.fileSize,
    mimeType: input.mimeType,
  });
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();

  // Validate event exists and is reunion
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, event_type")
    .eq("id", parsed.data.eventId)
    .maybeSingle();

  if (eventError) return { success: false, error: `Error al verificar evento: ${eventError.message}` };
  if (!event) return { success: false, error: "Evento no encontrado." };
  if ((event as { event_type: string }).event_type !== "reunion") {
    return { success: false, error: "Solo eventos de tipo reunión con acta pueden tener acta." };
  }

  // Upsert: one acta per event (UNIQUE event_id). Replace => update existing
  const { error } = await supabase.from("meeting_minutes").upsert(
    {
      event_id: parsed.data.eventId,
      file_path: parsed.data.filePath,
      file_name: parsed.data.fileName,
      file_size: parsed.data.fileSize,
      mime_type: parsed.data.mimeType,
      uploaded_by: profile!.id,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "event_id" },
  );

  if (error) {
    // Map DB trigger exception (event_type check) and unique/size violations
    if (error.message.includes("Solo eventos de tipo reunion")) {
      return { success: false, error: "Solo eventos de tipo reunión con acta pueden tener acta." };
    }
    if (error.code === "23505") return { success: false, error: "Este evento ya tiene un acta. Se reemplazará." };
    return { success: false, error: `Error al guardar acta: ${error.message}` };
  }

  return { success: true, data: null };
}

/**
 * Delete acta row and optionally storage object (via admin client if needed).
 * Currently only deletes DB row; storage object deletion handled by storage policies
 * if caller deletes via supabase.storage.from('meeting-minutes').remove([path]).
 */
export async function deleteMinutes(eventId: string): Promise<MutationResult> {
  const profile = await getCurrentProfile();
  const guard = requireManagementGuard(profile);
  if (guard) return guard;

  const parsed = deleteMinutesSchema.safeParse({ eventId });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  const supabase = await createClient();

  // Fetch to get file_path for storage cleanup (best-effort)
  const { data: existing } = await supabase
    .from("meeting_minutes")
    .select("file_path")
    .eq("event_id", parsed.data.eventId)
    .maybeSingle();

  const { error } = await supabase.from("meeting_minutes").delete().eq("event_id", parsed.data.eventId);
  if (error) return { success: false, error: `Error al eliminar acta: ${error.message}` };

  // Best-effort storage cleanup: try admin client remove (fails silently if not in bucket)
  if (existing?.file_path) {
    try {
      const admin = createAdminClient();
      await admin.storage.from("meeting-minutes").remove([existing.file_path]);
    } catch {
      // ignore storage cleanup failure; DB row already deleted
    }
  }

  return { success: true, data: null };
}

/**
 * Helper: upload file to storage (used by server action that receives FormData).
 * Validates reunion event before uploading to avoid orphan files.
 */
export async function uploadFileToStorage(
  eventId: string,
  file: File,
): Promise<MutationResult<{ filePath: string; fileName: string; fileSize: number; mimeType: string }>> {
  const profile = await getCurrentProfile();
  const guard = requireManagementGuard(profile);
  if (guard) return guard as MutationResult<never>;

  if (file.size > 10 * 1024 * 1024) return { success: false, error: "El fichero no puede superar 10 MB." };
  const allowed = [
    "application/pdf",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ];
  // Allow extension fallback for empty mime (some DOC files)
  let mimeType = file.type;
  if (!allowed.includes(mimeType)) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    if (ext === "pdf") mimeType = "application/pdf";
    else if (ext === "doc") mimeType = "application/msword";
    else if (ext === "docx") mimeType = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    else return { success: false, error: "Solo se permiten PDF, DOC y DOCX." };
  }

  const supabase = await createClient();
  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, event_type")
    .eq("id", eventId)
    .maybeSingle();
  if (eventError) return { success: false, error: eventError.message };
  if (!event) return { success: false, error: "Evento no encontrado." };
  if ((event as { event_type: string }).event_type !== "reunion") {
    return { success: false, error: "Solo eventos de tipo reunión con acta pueden tener acta." };
  }

  const ext = file.name.split(".").pop() ?? "pdf";
  const filePath = `${eventId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;

  // Use admin client to bypass storage RLS for upload (still validated by guard)
  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage.from("meeting-minutes").upload(filePath, file, {
    contentType: mimeType,
    upsert: false,
  });

  if (uploadError) return { success: false, error: `Error al subir fichero: ${uploadError.message}` };

  return {
    success: true,
    data: { filePath, fileName: file.name, fileSize: file.size, mimeType },
  };
}
