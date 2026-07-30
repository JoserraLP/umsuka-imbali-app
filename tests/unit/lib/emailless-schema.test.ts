import { describe, expect, it } from "vitest";
import {
  createEmaillessAccountSchema,
  resolveUsernameSchema,
} from "@/lib/auth/emailless-schema";

const VALID_PASSWORD = "SecurePass123!";

describe("createEmaillessAccountSchema", () => {
  it("accepts valid input with all fields", () => {
    const result = createEmaillessAccountSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      username: "ana_garcia",
      password: VALID_PASSWORD,
      componentType: "dance",
      workgroup: "telas",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid input without optional workgroup", () => {
    const result = createEmaillessAccountSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      username: "ana_garcia",
      password: VALID_PASSWORD,
      componentType: "dance",
    });
    expect(result.success).toBe(true);
  });

  it("accepts ninguno as workgroup", () => {
    const result = createEmaillessAccountSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      username: "ana_garcia",
      password: VALID_PASSWORD,
      componentType: "dance",
      workgroup: "ninguno",
    });
    expect(result.success).toBe(true);
  });

  it("rejects short username (less than 3 characters)", () => {
    const result = createEmaillessAccountSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      username: "ab",
      password: VALID_PASSWORD,
      componentType: "member",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error!.issues[0]!.path).toContain("username");
    }
  });

  it("rejects username with special characters", () => {
    const result = createEmaillessAccountSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      username: "ana garcia!",
      password: VALID_PASSWORD,
      componentType: "member",
    });
    expect(result.success).toBe(false);
  });

  it("rejects username with spaces", () => {
    const result = createEmaillessAccountSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      username: "ana garcia",
      password: VALID_PASSWORD,
      componentType: "member",
    });
    expect(result.success).toBe(false);
  });

  it("rejects weak password (no special character)", () => {
    const result = createEmaillessAccountSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      username: "ana_garcia",
      password: "SecurePass123", // missing special char
      componentType: "member",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error!.issues[0]!.path).toContain("password");
      expect(result.error!.issues[0]!.message).toContain("especial");
    }
  });

  it("rejects short password (less than 8 characters)", () => {
    const result = createEmaillessAccountSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      username: "ana_garcia",
      password: "Sh1!",
      componentType: "member",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error!.issues[0]!.path).toContain("password");
    }
  });

  it("rejects password without number", () => {
    const result = createEmaillessAccountSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      username: "ana_garcia",
      password: "SecurePass!!!",
      componentType: "member",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error!.issues[0]!.path).toContain("password");
      expect(result.error!.issues[0]!.message).toContain("número");
    }
  });

  it("rejects empty first name", () => {
    const result = createEmaillessAccountSchema.safeParse({
      firstName: "",
      lastName: "García",
      username: "ana_garcia",
      password: VALID_PASSWORD,
      componentType: "member",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty last name", () => {
    const result = createEmaillessAccountSchema.safeParse({
      firstName: "Ana",
      lastName: "",
      username: "ana_garcia",
      password: VALID_PASSWORD,
      componentType: "member",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid component type", () => {
    const result = createEmaillessAccountSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      username: "ana_garcia",
      password: VALID_PASSWORD,
      componentType: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid workgroup", () => {
    const result = createEmaillessAccountSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      username: "ana_garcia",
      password: VALID_PASSWORD,
      componentType: "member",
      workgroup: "invalid",
    });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from names and username", () => {
    const result = createEmaillessAccountSchema.safeParse({
      firstName: "  Ana  ",
      lastName: "  García  ",
      username: "  ana_garcia  ",
      password: VALID_PASSWORD,
      componentType: "member",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.firstName).toBe("Ana");
      expect(result.data.lastName).toBe("García");
      expect(result.data.username).toBe("ana_garcia");
    }
  });
});

describe("resolveUsernameSchema", () => {
  it("accepts a non-empty username", () => {
    const result = resolveUsernameSchema.safeParse({ username: "testuser" });
    expect(result.success).toBe(true);
  });

  it("accepts username with numbers and underscores", () => {
    const result = resolveUsernameSchema.safeParse({ username: "user_123" });
    expect(result.success).toBe(true);
  });

  it("rejects empty username", () => {
    const result = resolveUsernameSchema.safeParse({ username: "" });
    expect(result.success).toBe(false);
  });

  it("trims whitespace from username", () => {
    const result = resolveUsernameSchema.safeParse({ username: "  myuser  " });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.username).toBe("myuser");
    }
  });
});


