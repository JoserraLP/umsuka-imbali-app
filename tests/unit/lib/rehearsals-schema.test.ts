import { describe, it, expect } from "vitest";
import {
  REHEARSAL_SESSIONS,
  SESSION_LABELS,
  isRehearsalSession,
  markRehearsalAttendanceSchema,
  markMultipleRehearsalAttendanceSchema,
  clearRehearsalSessionSchema,
} from "@/lib/rehearsals/schema";

const UUID_1 = "323e4567-e89b-12d3-a456-426614174001";
const UUID_2 = "323e4567-e89b-12d3-a456-426614174002";

describe("rehearsal session constants", () => {
  it("exposes exactly the two DB enum values in display order", () => {
    expect(REHEARSAL_SESSIONS).toEqual(["morning", "afternoon"]);
  });

  it("labels every session in Spanish", () => {
    expect(SESSION_LABELS).toEqual({ morning: "Mañana", afternoon: "Tarde" });
  });

  it("isRehearsalSession accepts enum members and rejects others", () => {
    expect(isRehearsalSession("morning")).toBe(true);
    expect(isRehearsalSession("afternoon")).toBe(true);
    expect(isRehearsalSession("night")).toBe(false);
    expect(isRehearsalSession("")).toBe(false);
  });
});

describe("markRehearsalAttendanceSchema", () => {
  const valid = {
    eventId: UUID_1,
    userId: UUID_2,
    session: "morning",
    attended: true,
  };

  it("accepts a valid morning/afternoon mark", () => {
    expect(markRehearsalAttendanceSchema.safeParse(valid).success).toBe(true);
    expect(
      markRehearsalAttendanceSchema.safeParse({ ...valid, session: "afternoon", attended: false })
        .success,
    ).toBe(true);
  });

  it("rejects an invalid session value", () => {
    const result = markRehearsalAttendanceSchema.safeParse({ ...valid, session: "evening" });
    expect(result.success).toBe(false);
  });

  it("rejects non-uuid eventId/userId", () => {
    expect(
      markRehearsalAttendanceSchema.safeParse({ ...valid, eventId: "not-a-uuid" }).success,
    ).toBe(false);
    expect(
      markRehearsalAttendanceSchema.safeParse({ ...valid, userId: "not-a-uuid" }).success,
    ).toBe(false);
  });

  it("rejects a missing attended flag", () => {
    const { attended: _attended, ...withoutAttended } = valid;
    expect(markRehearsalAttendanceSchema.safeParse(withoutAttended).success).toBe(false);
  });
});

describe("markMultipleRehearsalAttendanceSchema", () => {
  const record = {
    eventId: UUID_1,
    userId: UUID_2,
    session: "afternoon",
    attended: true,
  };

  it("accepts a non-empty batch of records", () => {
    const result = markMultipleRehearsalAttendanceSchema.safeParse({
      records: [record, { ...record, userId: UUID_1 }],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty batch", () => {
    expect(markMultipleRehearsalAttendanceSchema.safeParse({ records: [] }).success).toBe(false);
  });
});

describe("clearRehearsalSessionSchema", () => {
  it("accepts a valid event + session pair", () => {
    expect(
      clearRehearsalSessionSchema.safeParse({ eventId: UUID_1, session: "morning" }).success,
    ).toBe(true);
  });

  it("rejects an invalid session and a bad uuid", () => {
    expect(
      clearRehearsalSessionSchema.safeParse({ eventId: UUID_1, session: "dawn" }).success,
    ).toBe(false);
    expect(
      clearRehearsalSessionSchema.safeParse({ eventId: "nope", session: "morning" }).success,
    ).toBe(false);
  });
});
