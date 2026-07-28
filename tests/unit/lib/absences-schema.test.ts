import { describe, expect, it } from "vitest";
import {
  requestAbsenceSchema,
  justifyAbsenceSchema,
  deleteAbsenceSchema,
} from "@/lib/absences/schema";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("requestAbsenceSchema", () => {
  it("accepts valid input", () => {
    const result = requestAbsenceSchema.safeParse({
      eventId: VALID_UUID,
      reason: "Motivo de prueba",
    });
    expect(result.success).toBe(true);
  });

  it("accepts reason with leading/trailing whitespace", () => {
    const result = requestAbsenceSchema.safeParse({
      eventId: VALID_UUID,
      reason: "  motivo con espacios  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.reason).toBe("motivo con espacios");
    }
  });

  it("rejects invalid eventId", () => {
    const result = requestAbsenceSchema.safeParse({
      eventId: "not-a-uuid",
      reason: "Motivo de prueba",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing reason", () => {
    const result = requestAbsenceSchema.safeParse({
      eventId: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty reason", () => {
    const result = requestAbsenceSchema.safeParse({
      eventId: VALID_UUID,
      reason: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects reason exceeding 500 characters", () => {
    const result = requestAbsenceSchema.safeParse({
      eventId: VALID_UUID,
      reason: "a".repeat(501),
    });
    expect(result.success).toBe(false);
  });

  it("accepts reason at exactly 500 characters", () => {
    const result = requestAbsenceSchema.safeParse({
      eventId: VALID_UUID,
      reason: "a".repeat(500),
    });
    expect(result.success).toBe(true);
  });
});

describe("justifyAbsenceSchema", () => {
  it("accepts justified = true", () => {
    const result = justifyAbsenceSchema.safeParse({
      absenceId: VALID_UUID,
      justified: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts justified = false", () => {
    const result = justifyAbsenceSchema.safeParse({
      absenceId: VALID_UUID,
      justified: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid absenceId", () => {
    const result = justifyAbsenceSchema.safeParse({
      absenceId: "not-a-uuid",
      justified: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing justified", () => {
    const result = justifyAbsenceSchema.safeParse({
      absenceId: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-boolean justified", () => {
    const result = justifyAbsenceSchema.safeParse({
      absenceId: VALID_UUID,
      justified: "yes",
    });
    expect(result.success).toBe(false);
  });
});

describe("deleteAbsenceSchema", () => {
  it("accepts valid absenceId", () => {
    const result = deleteAbsenceSchema.safeParse({ absenceId: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it("rejects invalid absenceId", () => {
    const result = deleteAbsenceSchema.safeParse({ absenceId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});
