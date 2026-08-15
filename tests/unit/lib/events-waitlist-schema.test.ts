import { describe, expect, it } from "vitest";
import {
  addEventCommentSchema,
  deleteEventCommentSchema,
  joinWaitlistSchema,
  leaveWaitlistSchema,
  setWaitlistEntryStatusSchema,
  WAITLIST_STATUSES,
} from "@/lib/events/schema";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";
const ANOTHER_UUID = "223e4567-e89b-12d3-a456-426614174000";

describe("joinWaitlistSchema", () => {
  it("accepts a valid event uuid", () => {
    const result = joinWaitlistSchema.safeParse({ eventId: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid event uuid", () => {
    const result = joinWaitlistSchema.safeParse({ eventId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects a missing eventId", () => {
    const result = joinWaitlistSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("leaveWaitlistSchema", () => {
  it("accepts a valid event uuid", () => {
    const result = leaveWaitlistSchema.safeParse({ eventId: VALID_UUID });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid event uuid", () => {
    const result = leaveWaitlistSchema.safeParse({ eventId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("setWaitlistEntryStatusSchema", () => {
  it("accepts every known waitlist status", () => {
    for (const status of WAITLIST_STATUSES) {
      const result = setWaitlistEntryStatusSchema.safeParse({
        eventId: VALID_UUID,
        entryId: ANOTHER_UUID,
        status,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects an unknown status", () => {
    const result = setWaitlistEntryStatusSchema.safeParse({
      eventId: VALID_UUID,
      entryId: ANOTHER_UUID,
      status: "maybe",
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid entryId", () => {
    const result = setWaitlistEntryStatusSchema.safeParse({
      eventId: VALID_UUID,
      entryId: "not-a-uuid",
      status: "promoted",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing eventId", () => {
    const result = setWaitlistEntryStatusSchema.safeParse({
      entryId: ANOTHER_UUID,
      status: "declined",
    });
    expect(result.success).toBe(false);
  });
});

describe("addEventCommentSchema", () => {
  it("accepts a valid body and trims it", () => {
    const result = addEventCommentSchema.safeParse({
      eventId: VALID_UUID,
      body: "  ¡Gran evento!  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.body).toBe("¡Gran evento!");
    }
  });

  it("rejects an empty or whitespace-only body", () => {
    expect(addEventCommentSchema.safeParse({ eventId: VALID_UUID, body: "" }).success).toBe(false);
    expect(addEventCommentSchema.safeParse({ eventId: VALID_UUID, body: "   " }).success).toBe(
      false,
    );
  });

  it("rejects a body longer than 1000 characters", () => {
    const result = addEventCommentSchema.safeParse({
      eventId: VALID_UUID,
      body: "a".repeat(1001),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid event uuid", () => {
    const result = addEventCommentSchema.safeParse({ eventId: "nope", body: "Hola" });
    expect(result.success).toBe(false);
  });
});

describe("deleteEventCommentSchema", () => {
  it("accepts a valid event and comment uuid", () => {
    const result = deleteEventCommentSchema.safeParse({
      eventId: VALID_UUID,
      commentId: ANOTHER_UUID,
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid comment uuid", () => {
    const result = deleteEventCommentSchema.safeParse({
      eventId: VALID_UUID,
      commentId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a missing commentId", () => {
    const result = deleteEventCommentSchema.safeParse({ eventId: VALID_UUID });
    expect(result.success).toBe(false);
  });
});
