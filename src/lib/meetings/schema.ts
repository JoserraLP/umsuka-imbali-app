import { z } from "zod";

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10 MB

export const MIME_LABELS: Record<AllowedMimeType, string> = {
  "application/pdf": "PDF",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
};

export function isAllowedMimeType(v: string): v is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(v);
}

// Reunion check helper: validated in mutations via DB, but schema enforces UUID
const uuidMessage = (field: string) => `${field} debe ser un UUID válido.`;

export const uploadMinutesSchema = z.object({
  eventId: z.string().uuid(uuidMessage("El evento")),
  fileName: z
    .string()
    .trim()
    .min(1, "El nombre del fichero es obligatorio.")
    .max(255, "El nombre debe tener 255 caracteres o menos."),
  fileSize: z
    .number()
    .int("El tamaño debe ser un entero.")
    .min(1, "El fichero no puede estar vacío.")
    .max(MAX_FILE_SIZE, "El fichero no puede superar 10 MB."),
  mimeType: z.enum(ALLOWED_MIME_TYPES, {
    errorMap: () => ({ message: "Solo se permiten PDF, DOC y DOCX." }),
  }),
  filePath: z
    .string()
    .trim()
    .min(1, "La ruta del fichero es obligatoria.")
    .max(500, "La ruta debe tener 500 caracteres o menos."),
});

export type UploadMinutesInput = z.infer<typeof uploadMinutesSchema>;

export const deleteMinutesSchema = z.object({
  eventId: z.string().uuid(uuidMessage("El evento")),
});

export type DeleteMinutesInput = z.infer<typeof deleteMinutesSchema>;

// Helper for file validation before upload (client/server)
export function validateFile(file: { name: string; size: number; type: string }): { valid: boolean; error?: string } {
  if (!isAllowedMimeType(file.type)) {
    // Fallback by extension when type is empty (some browsers)
    const ext = file.name.split(".").pop()?.toLowerCase();
    const extOk = ext === "pdf" || ext === "doc" || ext === "docx";
    if (!extOk) return { valid: false, error: "Solo se permiten ficheros PDF, DOC y DOCX." };
  }
  if (file.size < 1) return { valid: false, error: "El fichero no puede estar vacío." };
  if (file.size > MAX_FILE_SIZE) return { valid: false, error: "El fichero no puede superar 10 MB." };
  return { valid: true };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
