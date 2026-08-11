import { describe, it, expect } from "vitest";
import {
  newsFormSchema,
  createNewsSchema,
  updateNewsSchema,
  deleteNewsSchema,
  togglePinSchema,
} from "@/lib/news/schema";

// ── Valid base payload ────────────────────────────────
const validPayload = {
  title: "Nueva sede de Umsuka",
  content: "Nos mudamos a un local más grande en el centro de la ciudad.",
  image_url: null,
  published: true,
  pinned: false,
};

// ── newsFormSchema ────────────────────────────────────

describe("newsFormSchema", () => {
  it("accepts a valid payload", () => {
    const result = newsFormSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = newsFormSchema.safeParse({ ...validPayload, title: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toContain("title");
    }
  });

  it("rejects title exceeding 200 characters", () => {
    const result = newsFormSchema.safeParse({ ...validPayload, title: "A".repeat(201) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toContain("title");
    }
  });

  it("rejects empty content", () => {
    const result = newsFormSchema.safeParse({ ...validPayload, content: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toContain("content");
    }
  });

  it("rejects content exceeding 10000 characters", () => {
    const result = newsFormSchema.safeParse({ ...validPayload, content: "A".repeat(10001) });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toContain("content");
    }
  });

  it("transforms empty image_url to null", () => {
    const result = newsFormSchema.safeParse({ ...validPayload, image_url: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.image_url).toBeNull();
    }
  });

  it("accepts a valid image_url", () => {
    const result = newsFormSchema.safeParse({
      ...validPayload,
      image_url: "https://example.com/image.jpg",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.image_url).toBe("https://example.com/image.jpg");
    }
  });

  it("rejects invalid image_url", () => {
    const result = newsFormSchema.safeParse({ ...validPayload, image_url: "not-a-url" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toContain("image_url");
    }
  });

  it("defaults published to false when not provided", () => {
    const { title, content, image_url, pinned } = validPayload;
    const result = newsFormSchema.safeParse({ title, content, image_url, pinned });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.published).toBe(false);
    }
  });

  it("defaults pinned to false when not provided", () => {
    const { title, content, image_url, published } = validPayload;
    const result = newsFormSchema.safeParse({ title, content, image_url, published });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pinned).toBe(false);
    }
  });

  it("accepts explicit published true", () => {
    const result = newsFormSchema.safeParse({ ...validPayload, published: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.published).toBe(true);
    }
  });

  it("accepts explicit pinned true", () => {
    const result = newsFormSchema.safeParse({ ...validPayload, pinned: true });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pinned).toBe(true);
    }
  });
});

// ── createNewsSchema ──────────────────────────────────

describe("createNewsSchema", () => {
  it("accepts the same payload as newsFormSchema", () => {
    const result = createNewsSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });
});

// ── updateNewsSchema ──────────────────────────────────

describe("updateNewsSchema", () => {
  it("requires a valid UUID id", () => {
    const result = updateNewsSchema.safeParse({ ...validPayload, id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid UUID id", () => {
    const result = updateNewsSchema.safeParse({
      ...validPayload,
      id: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe("00000000-0000-0000-0000-000000000001");
    }
  });
});

// ── deleteNewsSchema ──────────────────────────────────

describe("deleteNewsSchema", () => {
  it("requires a valid UUID id", () => {
    const result = deleteNewsSchema.safeParse({ id: "" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid UUID id", () => {
    const result = deleteNewsSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000002",
    });
    expect(result.success).toBe(true);
  });
});

// ── togglePinSchema ───────────────────────────────────

describe("togglePinSchema", () => {
  it("requires a valid UUID id", () => {
    const result = togglePinSchema.safeParse({ id: "bad" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid UUID id", () => {
    const result = togglePinSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000003",
    });
    expect(result.success).toBe(true);
  });
});
