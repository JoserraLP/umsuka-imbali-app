import { describe, it, expect } from "vitest";
import {
  questionFormSchema,
  createQuestionSchema,
  updateQuestionSchema,
  deleteQuestionSchema,
  resolveQuestionSchema,
  addCommentSchema,
} from "@/lib/questions/schema";

// ── Valid base payload ────────────────────────────────
const validPayload = {
  title: "¿Cuándo es el próximo ensayo?",
  content: "Me gustaría saber la fecha del próximo ensayo general.",
  category: "ensayo" as const,
  priority: "media" as const,
};

// ── questionFormSchema ─────────────────────────────────

describe("questionFormSchema", () => {
  it("accepts a valid payload", () => {
    const result = questionFormSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = questionFormSchema.safeParse({
      ...validPayload,
      title: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("title");
    }
  });

  it("rejects title exceeding 200 characters", () => {
    const result = questionFormSchema.safeParse({
      ...validPayload,
      title: "A".repeat(201),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("title");
    }
  });

  it("rejects empty content", () => {
    const result = questionFormSchema.safeParse({
      ...validPayload,
      content: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("content");
    }
  });

  it("rejects content exceeding 5000 characters", () => {
    const result = questionFormSchema.safeParse({
      ...validPayload,
      content: "A".repeat(5001),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("content");
    }
  });

  it("defaults category to 'general' when not provided", () => {
    const { title, content, priority } = validPayload;
    const result = questionFormSchema.safeParse({ title, content, priority });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe("general");
    }
  });

  it("defaults priority to 'media' when not provided", () => {
    const { title, content, category } = validPayload;
    const result = questionFormSchema.safeParse({ title, content, category });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe("media");
    }
  });

  it("rejects invalid category", () => {
    const result = questionFormSchema.safeParse({
      ...validPayload,
      category: "invalido",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid priority", () => {
    const result = questionFormSchema.safeParse({
      ...validPayload,
      priority: "urgente",
    });
    expect(result.success).toBe(false);
  });

  it("accepts explicit category 'musica'", () => {
    const result = questionFormSchema.safeParse({
      ...validPayload,
      category: "musica",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBe("musica");
    }
  });

  it("accepts explicit priority 'alta'", () => {
    const result = questionFormSchema.safeParse({
      ...validPayload,
      priority: "alta",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.priority).toBe("alta");
    }
  });
});

// ── createQuestionSchema ───────────────────────────────

describe("createQuestionSchema", () => {
  it("accepts the same payload as questionFormSchema", () => {
    const result = createQuestionSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });
});

// ── updateQuestionSchema ───────────────────────────────

describe("updateQuestionSchema", () => {
  it("requires a valid UUID id", () => {
    const result = updateQuestionSchema.safeParse({
      ...validPayload,
      id: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a valid UUID id", () => {
    const result = updateQuestionSchema.safeParse({
      ...validPayload,
      id: "00000000-0000-0000-0000-000000000001",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.id).toBe(
        "00000000-0000-0000-0000-000000000001",
      );
    }
  });
});

// ── deleteQuestionSchema ───────────────────────────────

describe("deleteQuestionSchema", () => {
  it("requires a valid UUID id", () => {
    const result = deleteQuestionSchema.safeParse({ id: "" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid UUID id", () => {
    const result = deleteQuestionSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000002",
    });
    expect(result.success).toBe(true);
  });
});

// ── resolveQuestionSchema ──────────────────────────────

describe("resolveQuestionSchema", () => {
  it("requires a valid UUID id", () => {
    const result = resolveQuestionSchema.safeParse({
      id: "bad",
      resolved: true,
    });
    expect(result.success).toBe(false);
  });

  it("requires resolved to be a boolean", () => {
    const result = resolveQuestionSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000003",
      resolved: "yes",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid input with resolved=true", () => {
    const result = resolveQuestionSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000003",
      resolved: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid input with resolved=false", () => {
    const result = resolveQuestionSchema.safeParse({
      id: "00000000-0000-0000-0000-000000000004",
      resolved: false,
    });
    expect(result.success).toBe(true);
  });
});

// ── addCommentSchema ───────────────────────────────────

describe("addCommentSchema", () => {
  it("requires a valid UUID question_id", () => {
    const result = addCommentSchema.safeParse({
      question_id: "bad",
      content: "Un comentario válido.",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty content", () => {
    const result = addCommentSchema.safeParse({
      question_id: "00000000-0000-0000-0000-000000000005",
      content: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects content exceeding 2000 characters", () => {
    const result = addCommentSchema.safeParse({
      question_id: "00000000-0000-0000-0000-000000000005",
      content: "A".repeat(2001),
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid comment input", () => {
    const result = addCommentSchema.safeParse({
      question_id: "00000000-0000-0000-0000-000000000005",
      content: "Yo también tengo esa duda.",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.question_id).toBe(
        "00000000-0000-0000-0000-000000000005",
      );
      expect(result.data.content).toBe("Yo también tengo esa duda.");
    }
  });
});
