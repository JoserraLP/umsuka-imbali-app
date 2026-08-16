import { describe, it, expect } from "vitest";
import {
  votingFormSchema,
  createVotingSchema,
  addOptionSchema,
  castVoteSchema,
  closeVotingSchema,
} from "@/lib/votings/schema";
import { normalizeDeadlineInput } from "@/lib/votings/logic";

// ── Valid base payload ────────────────────────────────
const validPayload = {
  title: "¿Dónde celebramos el próximo ensayo general?",
  description: "Votación para elegir la sede del próximo ensayo general.",
  voting_deadline: "2099-01-01T00:00:00Z",
  options: ["Casa de la Cultura", "Centro Cívico"],
};

// ── votingFormSchema ──────────────────────────────────

describe("votingFormSchema", () => {
  it("accepts a valid payload", () => {
    const result = votingFormSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = votingFormSchema.safeParse({
      ...validPayload,
      title: "",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toContain("title");
    }
  });

  it("rejects title exceeding 200 characters", () => {
    const result = votingFormSchema.safeParse({
      ...validPayload,
      title: "A".repeat(201),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toContain("title");
    }
  });

  it("accepts a payload without description", () => {
    const { description: _description, ...rest } = validPayload;
    const result = votingFormSchema.safeParse(rest);
    expect(result.success).toBe(true);
  });

  it("rejects description exceeding 5000 characters", () => {
    const result = votingFormSchema.safeParse({
      ...validPayload,
      description: "A".repeat(5001),
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toContain("description");
    }
  });

  it("rejects an empty option", () => {
    const result = votingFormSchema.safeParse({
      ...validPayload,
      options: ["", "Centro Cívico"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an option exceeding 200 characters", () => {
    const result = votingFormSchema.safeParse({
      ...validPayload,
      options: ["A".repeat(201), "Centro Cívico"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a single option", () => {
    const result = votingFormSchema.safeParse({
      ...validPayload,
      options: ["Solo una opción"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects 21 options", () => {
    const result = votingFormSchema.safeParse({
      ...validPayload,
      options: Array.from({ length: 21 }, (_, i) => `Opción ${i + 1}`),
    });
    expect(result.success).toBe(false);
  });

  it("accepts exactly 20 options", () => {
    const result = votingFormSchema.safeParse({
      ...validPayload,
      options: Array.from({ length: 20 }, (_, i) => `Opción ${i + 1}`),
    });
    expect(result.success).toBe(true);
  });

  it("rejects duplicate options regardless of case", () => {
    const result = votingFormSchema.safeParse({
      ...validPayload,
      options: ["Música", "música"],
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.message).toContain("repetirse");
    }
  });

  it("accepts options that only differ in case", () => {
    const result = votingFormSchema.safeParse({
      ...validPayload,
      options: ["Música", "Danza"],
    });
    expect(result.success).toBe(true);
  });

  it("accepts an ISO deadline", () => {
    const result = votingFormSchema.safeParse({
      ...validPayload,
      voting_deadline: "2099-02-01T12:00:00.000Z",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a past deadline", () => {
    const result = votingFormSchema.safeParse({
      ...validPayload,
      voting_deadline: "2020-01-01T00:00:00Z",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toContain("voting_deadline");
      expect(result.error.issues[0]!.message).toContain("futuro");
    }
  });

  it("rejects a raw datetime-local value without normalization", () => {
    // datetime-local emits "YYYY-MM-DDTHH:mm" (no seconds, no offset);
    // the ISO-8601 schema check must reject it — the form resolver
    // normalizes it beforehand.
    const result = votingFormSchema.safeParse({
      ...validPayload,
      voting_deadline: "2099-01-01T23:59",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a raw datetime-local deadline after normalization", () => {
    const result = votingFormSchema.safeParse({
      ...validPayload,
      voting_deadline: normalizeDeadlineInput("2099-01-01T23:59"),
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.voting_deadline).toBe(
        new Date("2099-01-01T23:59").toISOString(),
      );
    }
  });

  it("rejects a non-ISO datetime", () => {
    const result = votingFormSchema.safeParse({
      ...validPayload,
      voting_deadline: "01/03/2026 10:00",
    });
    expect(result.success).toBe(false);
  });

  it("accepts a null deadline", () => {
    const result = votingFormSchema.safeParse({
      ...validPayload,
      voting_deadline: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts when the deadline is not provided", () => {
    const { voting_deadline: _voting_deadline, ...rest } = validPayload;
    const result = votingFormSchema.safeParse(rest);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.voting_deadline).toBeUndefined();
    }
  });
});

// ── createVotingSchema ─────────────────────────────────

describe("createVotingSchema", () => {
  it("accepts the same payload as votingFormSchema", () => {
    const result = createVotingSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });
});

// ── addOptionSchema ────────────────────────────────────

describe("addOptionSchema", () => {
  it("requires a valid UUID voting_id", () => {
    const result = addOptionSchema.safeParse({
      voting_id: "bad",
      option_text: "Nueva opción",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty option_text", () => {
    const result = addOptionSchema.safeParse({
      voting_id: "00000000-0000-0000-0000-000000000100",
      option_text: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects option_text exceeding 200 characters", () => {
    const result = addOptionSchema.safeParse({
      voting_id: "00000000-0000-0000-0000-000000000100",
      option_text: "A".repeat(201),
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid input", () => {
    const result = addOptionSchema.safeParse({
      voting_id: "00000000-0000-0000-0000-000000000100",
      option_text: "Nueva opción",
    });
    expect(result.success).toBe(true);
  });
});

// ── castVoteSchema ─────────────────────────────────────

describe("castVoteSchema", () => {
  it("requires valid UUIDs", () => {
    expect(
      castVoteSchema.safeParse({
        voting_id: "bad",
        option_id: "00000000-0000-0000-0000-000000000101",
      }).success,
    ).toBe(false);
    expect(
      castVoteSchema.safeParse({
        voting_id: "00000000-0000-0000-0000-000000000102",
        option_id: "bad",
      }).success,
    ).toBe(false);
  });

  it("accepts valid input", () => {
    const result = castVoteSchema.safeParse({
      voting_id: "00000000-0000-0000-0000-000000000102",
      option_id: "00000000-0000-0000-0000-000000000103",
    });
    expect(result.success).toBe(true);
  });
});

// ── closeVotingSchema ──────────────────────────────────

describe("closeVotingSchema", () => {
  it("requires a valid UUID voting_id", () => {
    const result = closeVotingSchema.safeParse({ voting_id: "" });
    expect(result.success).toBe(false);
  });

  it("accepts a valid UUID voting_id", () => {
    const result = closeVotingSchema.safeParse({
      voting_id: "00000000-0000-0000-0000-000000000104",
    });
    expect(result.success).toBe(true);
  });
});