import { describe, expect, it } from "vitest";
import { registerForEventSchema, unregisterFromEventSchema } from "@/lib/registrations/schema";

describe("registerForEventSchema", () => {
  it("accepts a valid uuid", () => {
    const result = registerForEventSchema.safeParse({
      eventId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid uuid", () => {
    const result = registerForEventSchema.safeParse({ eventId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});

describe("unregisterFromEventSchema", () => {
  it("accepts an eventId alone (self-unregistration)", () => {
    const result = unregisterFromEventSchema.safeParse({
      eventId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
  });

  it("accepts an eventId with an explicit userId (management removing someone else)", () => {
    const result = unregisterFromEventSchema.safeParse({
      eventId: "123e4567-e89b-12d3-a456-426614174000",
      userId: "223e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid userId when provided", () => {
    const result = unregisterFromEventSchema.safeParse({
      eventId: "123e4567-e89b-12d3-a456-426614174000",
      userId: "not-a-uuid",
    });
    expect(result.success).toBe(false);
  });
});
