"use server";

import { revalidatePath } from "next/cache";
import { uploadMinutes, deleteMinutes, uploadFileToStorage } from "@/lib/meetings/mutations";

export async function uploadMeetingMinutesAction(formData: FormData): Promise<{ success: boolean; error?: string }> {
  const eventId = String(formData.get("eventId") ?? "");
  const file = formData.get("file") as File | null;

  if (!eventId) return { success: false, error: "Evento no especificado." };
  if (!file || file.size === 0) return { success: false, error: "Fichero no especificado." };

  const upload = await uploadFileToStorage(eventId, file);
  if (!upload.success) return { success: false, error: upload.error };

  const { filePath, fileName, fileSize, mimeType } = upload.data;
  const result = await uploadMinutes({ eventId, filePath, fileName, fileSize, mimeType });
  if (!result.success) return { success: false, error: result.error };

  revalidatePath(`/events/${eventId}`);
  revalidatePath("/actas");
  revalidatePath("/events");
  return { success: true };
}

export async function deleteMeetingMinutesAction(eventId: string): Promise<{ success: boolean; error?: string }> {
  const result = await deleteMinutes(eventId);
  if (!result.success) return { success: false, error: result.error };
  revalidatePath(`/events/${eventId}`);
  revalidatePath("/actas");
  revalidatePath("/events");
  return { success: true };
}
