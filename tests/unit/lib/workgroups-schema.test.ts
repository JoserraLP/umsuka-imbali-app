import { describe, expect, it } from "vitest";
import {
  markWorkgroupAttendanceSchema,
  updateWorkgroupAttendanceSchema,
} from "@/lib/workgroups/schema";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("markWorkgroupAttendanceSchema", () => {
  it("accepts valid input with telas workgroup", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "telas",
      attended: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid input with barra workgroup and barraTask", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "barra",
      attended: false,
      barraTask: "cocina",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid input with barra workgroup and bebidas task", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "barra",
      attended: true,
      barraTask: "bebidas",
    });
    expect(result.success).toBe(true);
  });

  it("rejects barra workgroup without barraTask", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "barra",
      attended: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid barraTask values", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "barra",
      attended: true,
      barraTask: "limpieza",
    });
    expect(result.success).toBe(false);
  });

  it("rejects barraTask on non-barra workgroup", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "telas",
      attended: true,
      barraTask: "cocina",
    });
    expect(result.success).toBe(false);
  });

  it("accepts valid input with estandarte workgroup", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "estandarte",
      attended: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid input with limpieza workgroup", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "limpieza",
      attended: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid workgroup", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "invalid",
      attended: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects ninguno workgroup (not in active enum)", () => {
    // "ninguno" is not a valid active workgroup, so the enum parse itself fails
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "ninguno",
      attended: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid shiftId", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: "not-a-uuid",
      userId: VALID_UUID,
      workgroup: "telas",
      attended: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid userId", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: "not-a-uuid",
      workgroup: "telas",
      attended: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing shiftId", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      userId: VALID_UUID,
      workgroup: "telas",
      attended: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing userId", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      workgroup: "telas",
      attended: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing workgroup", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      attended: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing attended", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "telas",
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-boolean attended", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "telas",
      attended: "yes",
    });
    expect(result.success).toBe(false);
  });

  it("accepts hoursWorked for non-barra workgroup", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "telas",
      attended: true,
      hoursWorked: 4.5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts hoursWorked=null for non-barra workgroup", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "estandarte",
      attended: true,
      hoursWorked: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts hoursWorked not provided for non-barra workgroup", () => {
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "limpieza",
      attended: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts hoursWorked on barra (gets nullified in mutation)", () => {
    // The schema allows hoursWorked even for barra; the mutation layer
    // explicitly nullifies it in that case.
    const result = markWorkgroupAttendanceSchema.safeParse({
      shiftId: VALID_UUID,
      userId: VALID_UUID,
      workgroup: "barra",
      attended: true,
      barraTask: "cocina",
      hoursWorked: 4,
    });
    expect(result.success).toBe(true);
  });
});

describe("updateWorkgroupAttendanceSchema", () => {
  it("accepts valid input", () => {
    const result = updateWorkgroupAttendanceSchema.safeParse({
      id: VALID_UUID,
      attended: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts attended=false", () => {
    const result = updateWorkgroupAttendanceSchema.safeParse({
      id: VALID_UUID,
      attended: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid id", () => {
    const result = updateWorkgroupAttendanceSchema.safeParse({
      id: "not-a-uuid",
      attended: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing id", () => {
    const result = updateWorkgroupAttendanceSchema.safeParse({
      attended: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing attended", () => {
    const result = updateWorkgroupAttendanceSchema.safeParse({
      id: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-boolean attended", () => {
    const result = updateWorkgroupAttendanceSchema.safeParse({
      id: VALID_UUID,
      attended: 1,
    });
    expect(result.success).toBe(false);
  });

  it("accepts hoursWorked for update", () => {
    const result = updateWorkgroupAttendanceSchema.safeParse({
      id: VALID_UUID,
      attended: true,
      hoursWorked: 3.5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts barraTask for update", () => {
    const result = updateWorkgroupAttendanceSchema.safeParse({
      id: VALID_UUID,
      attended: true,
      barraTask: "bebidas",
    });
    expect(result.success).toBe(true);
  });

  it("rejects barraTask together with hoursWorked", () => {
    const result = updateWorkgroupAttendanceSchema.safeParse({
      id: VALID_UUID,
      attended: true,
      barraTask: "cocina",
      hoursWorked: 4,
    });
    expect(result.success).toBe(false);
  });
});
