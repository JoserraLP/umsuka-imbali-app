import { describe, it, expect } from "vitest";
import {
  createCategorySchema,
  updateCategorySchema,
  deleteCategorySchema,
  createDocumentSchema,
  updateDocumentSchema,
  deleteDocumentSchema,
  validateDocumentFile,
  MAX_FILE_SIZE,
  ALLOWED_MIME_TYPES,
} from "@/lib/documents/schema";

function longText(n: number) {
  return "x".repeat(n);
}

const CATEGORY_ID = "123e4567-e89b-12d3-a456-426614174010";
const DOCUMENT_ID = "123e4567-e89b-12d3-a456-426614174011";

describe("createCategorySchema", () => {
  it("accepts valid category and trims name", () => {
    const res = createCategorySchema.safeParse({ name: "  Estatutos  ", description: "Doc legal" });
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.name).toBe("Estatutos");
      expect(res.data.description).toBe("Doc legal");
    }
  });

  it("normalizes empty description to null", () => {
    const res = createCategorySchema.safeParse({ name: "Actas", description: "" });
    expect(res.success).toBe(true);
    if (res.success) expect(res.data.description).toBeNull();
  });

  it("accepts parentId nullable", () => {
    const res = createCategorySchema.safeParse({ name: "Hija", parentId: CATEGORY_ID });
    expect(res.success).toBe(true);
  });

  it("rejects empty name", () => {
    const res = createCategorySchema.safeParse({ name: "   " });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.message).toBe("El nombre de la categoría es obligatorio.");
  });

  it("rejects name >100", () => {
    const res = createCategorySchema.safeParse({ name: longText(101) });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.message).toBe("El nombre debe tener 100 caracteres o menos.");
  });

  it("rejects description >1000", () => {
    const res = createCategorySchema.safeParse({ name: "Actas", description: longText(1001) });
    expect(res.success).toBe(false);
  });

  it("rejects invalid parentId", () => {
    const res = createCategorySchema.safeParse({ name: "Actas", parentId: "bad" });
    expect(res.success).toBe(false);
  });
});

describe("updateCategorySchema", () => {
  it("requires id", () => {
    const res = updateCategorySchema.safeParse({ name: "Actas" });
    expect(res.success).toBe(false);
  });
  it("accepts valid id", () => {
    const res = updateCategorySchema.safeParse({ id: CATEGORY_ID, name: "Actas" });
    expect(res.success).toBe(true);
  });
});

describe("deleteCategorySchema", () => {
  it("accepts valid id", () => {
    expect(deleteCategorySchema.safeParse({ id: CATEGORY_ID }).success).toBe(true);
  });
  it("rejects bad uuid", () => {
    expect(deleteCategorySchema.safeParse({ id: "bad" }).success).toBe(false);
  });
});

describe("createDocumentSchema", () => {
  it("accepts valid document", () => {
    const res = createDocumentSchema.safeParse({
      name: "Estatutos 2026",
      categoryId: CATEGORY_ID,
      filePath: "uid/123.pdf",
      fileSize: 1024,
      mimeType: "application/pdf",
    });
    expect(res.success).toBe(true);
  });

  it("accepts nullable category", () => {
    const res = createDocumentSchema.safeParse({
      name: "Doc",
      categoryId: null,
      filePath: "path.pdf",
      fileSize: 100,
      mimeType: "image/png",
    });
    expect(res.success).toBe(true);
  });

  it("rejects empty name", () => {
    const res = createDocumentSchema.safeParse({
      name: "",
      filePath: "p.pdf",
      fileSize: 100,
      mimeType: "application/pdf",
    });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error.issues[0]?.message).toBe("El nombre del documento es obligatorio.");
  });

  it("rejects name >200", () => {
    const res = createDocumentSchema.safeParse({
      name: longText(201),
      filePath: "p.pdf",
      fileSize: 100,
      mimeType: "application/pdf",
    });
    expect(res.success).toBe(false);
  });

  it("rejects fileSize >20MB", () => {
    const res = createDocumentSchema.safeParse({
      name: "Doc",
      filePath: "p.pdf",
      fileSize: MAX_FILE_SIZE + 1,
      mimeType: "application/pdf",
    });
    expect(res.success).toBe(false);
  });

  it("rejects invalid mime", () => {
    const res = createDocumentSchema.safeParse({
      name: "Doc",
      filePath: "p.pdf",
      fileSize: 100,
      mimeType: "application/zip",
    });
    expect(res.success).toBe(false);
  });

  it("rejects filePath >500", () => {
    const res = createDocumentSchema.safeParse({
      name: "Doc",
      filePath: longText(501),
      fileSize: 100,
      mimeType: "application/pdf",
    });
    expect(res.success).toBe(false);
  });
});

describe("updateDocumentSchema", () => {
  it("accepts valid update", () => {
    const res = updateDocumentSchema.safeParse({ id: DOCUMENT_ID, name: "Nuevo nombre", categoryId: null });
    expect(res.success).toBe(true);
  });
  it("rejects missing id", () => {
    const res = updateDocumentSchema.safeParse({ name: "Nuevo" } as never);
    expect(res.success).toBe(false);
  });
});

describe("deleteDocumentSchema", () => {
  it("accepts uuid", () => {
    expect(deleteDocumentSchema.safeParse({ id: DOCUMENT_ID }).success).toBe(true);
  });
  it("rejects bad uuid", () => {
    expect(deleteDocumentSchema.safeParse({ id: "bad" }).success).toBe(false);
  });
});

describe("validateDocumentFile", () => {
  it("accepts allowed mimes", () => {
    for (const mime of ALLOWED_MIME_TYPES) {
      expect(validateDocumentFile({ name: `file.${mime.split("/").pop()}`, size: 1000, type: mime }).valid).toBe(true);
    }
  });

  it("rejects disallowed mime with no extension fallback", () => {
    expect(validateDocumentFile({ name: "archive.zip", size: 1000, type: "application/zip" }).valid).toBe(false);
  });

  it("fallback by extension when mime empty", () => {
    expect(validateDocumentFile({ name: "doc.pdf", size: 1000, type: "" }).valid).toBe(true);
    expect(validateDocumentFile({ name: "foto.png", size: 1000, type: "" }).valid).toBe(true);
    expect(validateDocumentFile({ name: "sheet.xlsx", size: 1000, type: "" }).valid).toBe(true);
    expect(validateDocumentFile({ name: "archive.zip", size: 1000, type: "" }).valid).toBe(false);
  });

  it("rejects empty and oversized", () => {
    expect(validateDocumentFile({ name: "a.pdf", size: 0, type: "application/pdf" }).valid).toBe(false);
    expect(validateDocumentFile({ name: "a.pdf", size: MAX_FILE_SIZE + 1, type: "application/pdf" }).valid).toBe(false);
  });

  it("handles jpg/jpeg as jpeg", () => {
    expect(validateDocumentFile({ name: "foto.jpg", size: 1000, type: "" }).valid).toBe(true);
    expect(validateDocumentFile({ name: "foto.jpeg", size: 1000, type: "" }).valid).toBe(true);
  });
});
