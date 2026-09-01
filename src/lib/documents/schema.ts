import { z } from "zod";

export const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "text/plain",
  "text/csv",
] as const;
export type AllowedMimeType = (typeof ALLOWED_MIME_TYPES)[number];

export const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB

export const MIME_LABELS: Record<AllowedMimeType, string> = {
  "application/pdf": "PDF",
  "application/msword": "DOC",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "DOCX",
  "application/vnd.ms-excel": "XLS",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "XLSX",
  "application/vnd.ms-powerpoint": "PPT",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "PPTX",
  "image/png": "PNG",
  "image/jpeg": "JPEG",
  "image/jpg": "JPG",
  "text/plain": "TXT",
  "text/csv": "CSV",
};

export function isAllowedMimeType(v: string): v is AllowedMimeType {
  return (ALLOWED_MIME_TYPES as readonly string[]).includes(v);
}

const uuidMessage = (field: string) => `${field} debe ser un UUID válido.`;

export const createCategorySchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre de la categoría es obligatorio.")
    .max(100, "El nombre debe tener 100 caracteres o menos."),
  description: z
    .string()
    .trim()
    .max(1000, "La descripción debe tener 1000 caracteres o menos.")
    .nullable()
    .optional()
    .transform((v) => {
      if (v === undefined || v === null) return null;
      if (v === "") return null;
      return v;
    }),
  parentId: z.string().uuid(uuidMessage("La categoría padre")).nullable().optional(),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

export const updateCategorySchema = createCategorySchema.extend({
  id: z.string().uuid(uuidMessage("La categoría")),
});

export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;

export const deleteCategorySchema = z.object({
  id: z.string().uuid(uuidMessage("La categoría")),
});

export type DeleteCategoryInput = z.infer<typeof deleteCategorySchema>;

export const createDocumentSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "El nombre del documento es obligatorio.")
    .max(200, "El nombre debe tener 200 caracteres o menos."),
  categoryId: z.string().uuid(uuidMessage("La categoría")).nullable().optional(),
  filePath: z
    .string()
    .trim()
    .min(1, "La ruta del fichero es obligatoria.")
    .max(500, "La ruta debe tener 500 caracteres o menos."),
  fileSize: z
    .number()
    .int("El tamaño debe ser un entero.")
    .min(1, "El fichero no puede estar vacío.")
    .max(MAX_FILE_SIZE, "El fichero no puede superar 20 MB."),
  mimeType: z.enum(ALLOWED_MIME_TYPES, {
    errorMap: () => ({ message: "Tipo de fichero no permitido." }),
  }),
});

export type CreateDocumentInput = z.infer<typeof createDocumentSchema>;

export const updateDocumentSchema = z.object({
  id: z.string().uuid(uuidMessage("El documento")),
  name: z
    .string()
    .trim()
    .min(1, "El nombre del documento es obligatorio.")
    .max(200, "El nombre debe tener 200 caracteres o menos."),
  categoryId: z.string().uuid(uuidMessage("La categoría")).nullable().optional(),
});

export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;

export const deleteDocumentSchema = z.object({
  id: z.string().uuid(uuidMessage("El documento")),
});

export type DeleteDocumentInput = z.infer<typeof deleteDocumentSchema>;

export function validateDocumentFile(file: { name: string; size: number; type: string }): {
  valid: boolean;
  error?: string;
} {
  let mime = file.type;
  if (!isAllowedMimeType(mime)) {
    const ext = file.name.split(".").pop()?.toLowerCase();
    const extToMime: Record<string, AllowedMimeType> = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ppt: "application/vnd.ms-powerpoint",
      pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      png: "image/png",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      txt: "text/plain",
      csv: "text/csv",
    };
    if (ext && extToMime[ext]) {
      mime = extToMime[ext];
    } else {
      return { valid: false, error: "Tipo de fichero no permitido." };
    }
  }
  if (file.size < 1) return { valid: false, error: "El fichero no puede estar vacío." };
  if (file.size > MAX_FILE_SIZE) return { valid: false, error: "El fichero no puede superar 20 MB." };
  return { valid: true };
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function inferMimeFromExtension(fileName: string, fallback: string): string {
  const ext = fileName.split(".").pop()?.toLowerCase();
  const map: Record<string, string> = {
    pdf: "application/pdf",
    doc: "application/msword",
    docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    xls: "application/vnd.ms-excel",
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ppt: "application/vnd.ms-powerpoint",
    pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    txt: "text/plain",
    csv: "text/csv",
  };
  if (ext && map[ext]) return map[ext];
  return fallback;
}
