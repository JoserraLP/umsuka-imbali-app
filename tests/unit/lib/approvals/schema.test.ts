import { describe, expect, it } from "vitest";
import { approveUserSchema, suspendUserSchema } from "@/lib/approvals/schema";

describe("approveUserSchema", () => {
  it("accepts a valid uuid", () => {
    const result = approveUserSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid uuid", () => {
    const result = approveUserSchema.safeParse({ userId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects missing userId", () => {
    const result = approveUserSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

describe("suspendUserSchema", () => {
  it("accepts a valid uuid", () => {
    const result = suspendUserSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid uuid", () => {
    const result = suspendUserSchema.safeParse({ userId: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects missing userId", () => {
    const result = suspendUserSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});
