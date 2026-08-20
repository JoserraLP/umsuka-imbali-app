import { describe, expect, it } from "vitest";
import {
  createInstrumentSchema,
  updateInstrumentSchema,
  assignSchema,
  unassignSchema,
  toggleInstrumentActiveSchema,
} from "@/lib/instruments/schema";

const INSTRUMENT_ID = "123e4567-e89b-12d3-a456-426614174001";
const USER_ID = "123e4567-e89b-12d3-a456-426614174002";

function longText(length: number): string {
  return "x".repeat(length);
}

describe("createInstrumentSchema", () => {
  it("accepts a valid instrument and trims the name", () => {
    const result = createInstrumentSchema.safeParse({
      name: "  Tambor Mayor  ",
      category: "Percusión",
      description: "Se usa en los desfiles",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Tambor Mayor");
      expect(result.data.category).toBe("Percusión");
      expect(result.data.description).toBe("Se usa en los desfiles");
    }
  });

  it("normalizes an empty category and description to null", () => {
    const result = createInstrumentSchema.safeParse({
      name: "Tambor",
      category: "",
      description: "   ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBeNull();
      expect(result.data.description).toBeNull();
    }
  });

  it("accepts omitted optional fields", () => {
    const result = createInstrumentSchema.safeParse({ name: "Tambor" });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.category).toBeUndefined();
      expect(result.data.description).toBeUndefined();
    }
  });

  it("rejects an empty and a whitespace-only name", () => {
    for (const name of ["", "   "]) {
      const result = createInstrumentSchema.safeParse({ name });
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.issues[0]?.message).toBe("El nombre es obligatorio.");
      }
    }
  });

  it("rejects a name longer than 200 characters", () => {
    const result = createInstrumentSchema.safeParse({
      name: longText(201),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "El nombre debe tener 200 caracteres o menos.",
      );
    }
  });

  it("rejects a category longer than 100 characters", () => {
    const result = createInstrumentSchema.safeParse({
      name: "Tambor",
      category: longText(101),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "La categoría debe tener 100 caracteres o menos.",
      );
    }
  });

  it("rejects a description longer than 2000 characters", () => {
    const result = createInstrumentSchema.safeParse({
      name: "Tambor",
      description: longText(2001),
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "La descripción debe tener 2000 caracteres o menos.",
      );
    }
  });
});

describe("updateInstrumentSchema", () => {
  it("accepts a valid id with fields", () => {
    const result = updateInstrumentSchema.safeParse({
      id: INSTRUMENT_ID,
      name: "Tambor",
      category: "",
      description: "Nueva descripción",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID id", () => {
    const result = updateInstrumentSchema.safeParse({
      id: "not-a-uuid",
      name: "Tambor",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("id debe ser un UUID válido.");
    }
  });

  it("rejects a missing id", () => {
    const result = updateInstrumentSchema.safeParse({ name: "Tambor" });

    expect(result.success).toBe(false);
  });

  it("keeps the create validations", () => {
    const result = updateInstrumentSchema.safeParse({
      id: INSTRUMENT_ID,
      name: "",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("El nombre es obligatorio.");
    }
  });
});

describe("assignSchema", () => {
  it("accepts valid UUIDs", () => {
    const result = assignSchema.safeParse({
      instrument_id: INSTRUMENT_ID,
      user_id: USER_ID,
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid instrument_id", () => {
    const result = assignSchema.safeParse({
      instrument_id: "bad",
      user_id: USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "instrument_id debe ser un UUID válido.",
      );
    }
  });

  it("rejects an invalid user_id", () => {
    const result = assignSchema.safeParse({
      instrument_id: INSTRUMENT_ID,
      user_id: "bad",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "user_id debe ser un UUID válido.",
      );
    }
  });

  it("rejects a missing user_id", () => {
    const result = assignSchema.safeParse({ instrument_id: INSTRUMENT_ID });

    expect(result.success).toBe(false);
  });
});

describe("unassignSchema", () => {
  it("accepts a valid UUID", () => {
    const result = unassignSchema.safeParse({ instrument_id: INSTRUMENT_ID });

    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID instrument_id", () => {
    const result = unassignSchema.safeParse({ instrument_id: "bad" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "instrument_id debe ser un UUID válido.",
      );
    }
  });
});

describe("toggleInstrumentActiveSchema", () => {
  it("accepts a valid UUID", () => {
    const result = toggleInstrumentActiveSchema.safeParse({
      instrument_id: INSTRUMENT_ID,
    });

    expect(result.success).toBe(true);
  });

  it("rejects a non-UUID instrument_id", () => {
    const result = toggleInstrumentActiveSchema.safeParse({
      instrument_id: "bad",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "instrument_id debe ser un UUID válido.",
      );
    }
  });
});