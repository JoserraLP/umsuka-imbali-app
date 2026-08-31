import { describe, expect, it } from "vitest";
import { preRegisterMemberSchema, linkGmailSchema } from "@/lib/members/pre-register-schema";

describe("preRegisterMemberSchema", () => {
  const valid = {
    first_name: "Ana",
    last_name: "García",
    component_type: "dance" as const,
    workgroup: "telas" as const,
  };

  it("accepts valid minimal input", () => {
    expect(preRegisterMemberSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects empty first_name", () => {
    const r = preRegisterMemberSchema.safeParse({ ...valid, first_name: "" });
    expect(r.success).toBe(false);
  });

  it("rejects empty last_name", () => {
    const r = preRegisterMemberSchema.safeParse({ ...valid, last_name: "" });
    expect(r.success).toBe(false);
  });

  it("rejects first_name >100", () => {
    const r = preRegisterMemberSchema.safeParse({ ...valid, first_name: "a".repeat(101) });
    expect(r.success).toBe(false);
  });

  it("rejects invalid component_type", () => {
    const r = preRegisterMemberSchema.safeParse({ ...valid, component_type: "invalid" as never });
    expect(r.success).toBe(false);
  });

  it("rejects invalid workgroup", () => {
    const r = preRegisterMemberSchema.safeParse({ ...valid, workgroup: "invalid" as never });
    expect(r.success).toBe(false);
  });

  it("accepts pending_email valid", () => {
    const r = preRegisterMemberSchema.safeParse({ ...valid, pending_email: "test@example.com" });
    expect(r.success).toBe(true);
  });

  it("rejects pending_email invalid", () => {
    const r = preRegisterMemberSchema.safeParse({ ...valid, pending_email: "not-email" });
    expect(r.success).toBe(false);
  });

  it("trims names", () => {
    const r = preRegisterMemberSchema.safeParse({ ...valid, first_name: "  Ana  ", last_name: "  García  " });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.first_name).toBe("Ana");
    }
  });
});

describe("linkGmailSchema", () => {
  it("accepts valid gmail", () => {
    const r = linkGmailSchema.safeParse({ profileId: "550e8400-e29b-41d4-a716-446655440000", gmail: "test@gmail.com" });
    expect(r.success).toBe(true);
  });

  it("rejects invalid uuid", () => {
    const r = linkGmailSchema.safeParse({ profileId: "not-uuid", gmail: "test@gmail.com" });
    expect(r.success).toBe(false);
  });

  it("rejects invalid email", () => {
    const r = linkGmailSchema.safeParse({ profileId: "550e8400-e29b-41d4-a716-446655440000", gmail: "not-email" });
    expect(r.success).toBe(false);
  });

  it("accepts optional invite_token", () => {
    const r = linkGmailSchema.safeParse({ profileId: "550e8400-e29b-41d4-a716-446655440000", gmail: "a@b.com", invite_token: "550e8400-e29b-41d4-a716-446655440001" });
    expect(r.success).toBe(true);
  });
});
