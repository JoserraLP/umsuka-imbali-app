import { describe, it, expect } from "vitest";
import { uploadMinutesSchema, validateFile, MAX_FILE_SIZE, ALLOWED_MIME_TYPES } from "@/lib/meetings/schema";

describe("meetings/schema", () => {
  it("acepta un upload válido", () => {
    const res = uploadMinutesSchema.safeParse({
      eventId: "00000000-0000-4000-a000-000000000001",
      fileName: "acta.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
      filePath: "00000000-0000-4000-a000-000000000001/123-abc.pdf",
    });
    expect(res.success).toBe(true);
  });

  it("rechaza mime no permitido", () => {
    const res = uploadMinutesSchema.safeParse({
      eventId: "00000000-0000-4000-a000-000000000001",
      fileName: "foto.png",
      fileSize: 1024,
      mimeType: "image/png",
      filePath: "path.png",
    });
    expect(res.success).toBe(false);
  });

  it("rechaza tamaño >10MB", () => {
    const res = uploadMinutesSchema.safeParse({
      eventId: "00000000-0000-4000-a000-000000000001",
      fileName: "acta.pdf",
      fileSize: MAX_FILE_SIZE + 1,
      mimeType: "application/pdf",
      filePath: "path.pdf",
    });
    expect(res.success).toBe(false);
  });

  it("validateFile acepta pdf y rechaza png", () => {
    expect(validateFile({ name: "acta.pdf", size: 1000, type: "application/pdf" }).valid).toBe(true);
    expect(validateFile({ name: "acta.png", size: 1000, type: "image/png" }).valid).toBe(false);
    expect(validateFile({ name: "acta.docx", size: MAX_FILE_SIZE + 1, type: ALLOWED_MIME_TYPES[0] }).valid).toBe(false);
  });

  it("fallback por extensión doc/docx cuando mime vacío", () => {
    expect(validateFile({ name: "acta.doc", size: 1000, type: "" }).valid).toBe(true);
    expect(validateFile({ name: "acta.docx", size: 1000, type: "" }).valid).toBe(true);
    expect(validateFile({ name: "foto.png", size: 1000, type: "" }).valid).toBe(false);
  });
});
