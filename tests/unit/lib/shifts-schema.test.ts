import { describe, expect, it } from "vitest";
import {
  shiftFormSchema,
  createShiftSchema,
  updateShiftSchema,
  deleteShiftSchema,
  assignMemberSchema,
  unassignMemberSchema,
} from "@/lib/shifts/schema";

describe("shiftFormSchema", () => {
  it("accepts valid input", () => {
    const result = shiftFormSchema.safeParse({
      name: "Montaje de barra",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("Montaje de barra");
      expect(result.data.maxAssignees).toBeNull();
      expect(result.data.workgroup).toBeNull();
      expect(result.data.notes).toBeNull();
    }
  });

  it("rejects an empty name", () => {
    const result = shiftFormSchema.safeParse({
      name: "",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
    });

    expect(result.success).toBe(false);
  });

  it("rejects endTime before startTime", () => {
    const result = shiftFormSchema.safeParse({
      name: "Test shift",
      startTime: "2026-08-15T14:00",
      endTime: "2026-08-15T10:00",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path.includes("endTime"))).toBe(true);
    }
  });

  it("normalizes an empty notes string to null", () => {
    const result = shiftFormSchema.safeParse({
      name: "Test shift",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
      notes: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBeNull();
    }
  });

  it("keeps a non-empty notes string", () => {
    const result = shiftFormSchema.safeParse({
      name: "Test shift",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
      notes: "Traer herramientas",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notes).toBe("Traer herramientas");
    }
  });

  it("normalizes NaN maxAssignees to null", () => {
    const result = shiftFormSchema.safeParse({
      name: "Test shift",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
      maxAssignees: Number.NaN,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxAssignees).toBeNull();
    }
  });

  it("accepts a positive integer maxAssignees", () => {
    const result = shiftFormSchema.safeParse({
      name: "Test shift",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
      maxAssignees: 5,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.maxAssignees).toBe(5);
    }
  });

  it("rejects non-integer maxAssignees", () => {
    const result = shiftFormSchema.safeParse({
      name: "Test shift",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
      maxAssignees: 3.5,
    });

    expect(result.success).toBe(false);
  });

  it("rejects zero or negative maxAssignees", () => {
    const result = shiftFormSchema.safeParse({
      name: "Test shift",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
      maxAssignees: 0,
    });

    expect(result.success).toBe(false);
  });

  it("accepts a workgroup filter", () => {
    const result = shiftFormSchema.safeParse({
      name: "Test shift",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
      workgroup: "barra",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.workgroup).toBe("barra");
    }
  });

  it("accepts ninguno as workgroup (no filter)", () => {
    const result = shiftFormSchema.safeParse({
      name: "Test shift",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
      workgroup: "ninguno",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid workgroup value", () => {
    const result = shiftFormSchema.safeParse({
      name: "Test shift",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
      workgroup: "invalid",
    });

    expect(result.success).toBe(false);
  });

  it("accepts all optional fields", () => {
    const result = shiftFormSchema.safeParse({
      name: "Test shift completo",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
      maxAssignees: 10,
      workgroup: "telas",
      notes: "Notas de prueba",
    });

    expect(result.success).toBe(true);
  });
});

describe("createShiftSchema", () => {
  it("requires a valid eventId UUID", () => {
    const result = createShiftSchema.safeParse({
      eventId: "123e4567-e89b-12d3-a456-426614174000",
      name: "Test shift",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a missing eventId", () => {
    const result = createShiftSchema.safeParse({
      name: "Test shift",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
    });

    expect(result.success).toBe(false);
  });
});

describe("updateShiftSchema", () => {
  it("requires both id and eventId UUIDs", () => {
    const result = updateShiftSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      eventId: "223e4567-e89b-12d3-a456-426614174001",
      name: "Updated shift",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a missing id", () => {
    const result = updateShiftSchema.safeParse({
      eventId: "223e4567-e89b-12d3-a456-426614174001",
      name: "Updated shift",
      startTime: "2026-08-15T10:00",
      endTime: "2026-08-15T14:00",
    });

    expect(result.success).toBe(false);
  });
});

describe("deleteShiftSchema", () => {
  it("accepts a valid UUID", () => {
    const result = deleteShiftSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid UUID", () => {
    const result = deleteShiftSchema.safeParse({ id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("assignMemberSchema", () => {
  it("accepts valid UUIDs", () => {
    const result = assignMemberSchema.safeParse({
      shiftId: "123e4567-e89b-12d3-a456-426614174000",
      userId: "223e4567-e89b-12d3-a456-426614174001",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing shiftId", () => {
    const result = assignMemberSchema.safeParse({
      userId: "223e4567-e89b-12d3-a456-426614174001",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing userId", () => {
    const result = assignMemberSchema.safeParse({
      shiftId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(false);
  });
});

describe("unassignMemberSchema", () => {
  it("accepts a valid assignmentId UUID", () => {
    const result = unassignMemberSchema.safeParse({
      assignmentId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid assignmentId", () => {
    const result = unassignMemberSchema.safeParse({ assignmentId: "bad" });
    expect(result.success).toBe(false);
  });
});
