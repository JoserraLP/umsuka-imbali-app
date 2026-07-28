import { describe, expect, it } from "vitest";
import {
  markAttendanceSchema,
  markMultipleAttendanceSchema,
  updateAttendanceSchema,
  deleteAttendanceSchema,
} from "@/lib/attendance/schema";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";
const ANOTHER_UUID = "223e4567-e89b-12d3-a456-426614174000";

describe("markAttendanceSchema", () => {
  it("accepts valid input", () => {
    const result = markAttendanceSchema.safeParse({
      eventId: VALID_UUID,
      userId: ANOTHER_UUID,
      attended: true,
    });
    expect(result.success).toBe(true);
  });

  it("accepts attended = false", () => {
    const result = markAttendanceSchema.safeParse({
      eventId: VALID_UUID,
      userId: ANOTHER_UUID,
      attended: false,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid eventId", () => {
    const result = markAttendanceSchema.safeParse({
      eventId: "not-a-uuid",
      userId: ANOTHER_UUID,
      attended: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid userId", () => {
    const result = markAttendanceSchema.safeParse({
      eventId: VALID_UUID,
      userId: "not-a-uuid",
      attended: true,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing attended", () => {
    const result = markAttendanceSchema.safeParse({
      eventId: VALID_UUID,
      userId: ANOTHER_UUID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects non-boolean attended", () => {
    const result = markAttendanceSchema.safeParse({
      eventId: VALID_UUID,
      userId: ANOTHER_UUID,
      attended: "yes",
    });
    expect(result.success).toBe(false);
  });
});

describe("markMultipleAttendanceSchema", () => {
  it("accepts a single record", () => {
    const result = markMultipleAttendanceSchema.safeParse({
      records: [
        { eventId: VALID_UUID, userId: ANOTHER_UUID, attended: true },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("accepts multiple records", () => {
    const result = markMultipleAttendanceSchema.safeParse({
      records: [
        { eventId: VALID_UUID, userId: ANOTHER_UUID, attended: true },
        { eventId: VALID_UUID, userId: VALID_UUID, attended: false },
      ],
    });
    expect(result.success).toBe(true);
  });

  it("rejects empty array", () => {
    const result = markMultipleAttendanceSchema.safeParse({ records: [] });
    expect(result.success).toBe(false);
  });

  it("rejects invalid record inside array", () => {
    const result = markMultipleAttendanceSchema.safeParse({
      records: [
        { eventId: VALID_UUID, userId: ANOTHER_UUID, attended: true },
        { eventId: "bad-id", userId: ANOTHER_UUID, attended: true },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe("updateAttendanceSchema", () => {
  it("accepts valid input", () => {
    const result = updateAttendanceSchema.safeParse({
      id: VALID_UUID,
      attended: true,
    });
    expect(result.success).toBe(true);
  });

  it("rejects invalid id", () => {
    const result = updateAttendanceSchema.safeParse({
      id: "not-a-uuid",
      attended: false,
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing attended", () => {
    const result = updateAttendanceSchema.safeParse({ id: VALID_UUID });
    expect(result.success).toBe(false);
  });
});

describe("deleteAttendanceSchema", () => {
  it("accepts valid id", () => {
    const result = deleteAttendanceSchema.safeParse({ id: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it("rejects invalid id", () => {
    const result = deleteAttendanceSchema.safeParse({ id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});
