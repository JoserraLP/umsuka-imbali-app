import { describe, expect, it } from "vitest";
import {
  updateOwnProfileSchema,
  updateMemberRoleSchema,
  updateMemberProfileSchema,
  setMemberActiveSchema,
  setMemberWorkgroupSchema,
} from "@/lib/profiles/schema";

describe("updateOwnProfileSchema", () => {
  it("accepts valid input and normalizes an empty birth date to null", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      birthDate: "",
      componentType: "dance",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.birthDate).toBeNull();
    }
  });

  it("accepts a valid ISO birth date", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      birthDate: "1990-05-12",
      componentType: "music",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.birthDate).toBe("1990-05-12");
    }
  });

  it("rejects an empty first name", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "",
      lastName: "García",
      componentType: "member",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid component type", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "cooking",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unparsable birth date", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      birthDate: "not-a-date",
      componentType: "member",
    });

    expect(result.success).toBe(false);
  });
});

describe("updateMemberRoleSchema", () => {
  it("accepts a valid uuid and known role", () => {
    const result = updateMemberRoleSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      role: "board_member",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid uuid", () => {
    const result = updateMemberRoleSchema.safeParse({
      userId: "not-a-uuid",
      role: "member",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unknown role", () => {
    const result = updateMemberRoleSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      role: "superuser",
    });

    expect(result.success).toBe(false);
  });
});

describe("updateMemberProfileSchema", () => {
  it("accepts valid input for a specific member (admin editing someone else)", () => {
    const result = updateMemberProfileSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      firstName: "Ana",
      lastName: "García",
      birthDate: "1990-05-12",
      componentType: "dance",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a missing userId", () => {
    const result = updateMemberProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
    });

    expect(result.success).toBe(false);
  });

  it("still validates the underlying personal-field rules", () => {
    const result = updateMemberProfileSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      firstName: "",
      lastName: "García",
      componentType: "member",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a workgroup when the admin changes it", () => {
    const result = updateMemberProfileSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      firstName: "Ana",
      lastName: "García",
      componentType: "dance",
      workgroup: "telas",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid workgroup value", () => {
    const result = updateMemberProfileSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      workgroup: "presidencia",
    });

    expect(result.success).toBe(false);
  });
});

describe("setMemberWorkgroupSchema", () => {
  it("accepts a valid uuid and workgroup", () => {
    const result = setMemberWorkgroupSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      workgroup: "limpieza",
    });

    expect(result.success).toBe(true);
  });

  it("accepts ninguno as a workgroup", () => {
    const result = setMemberWorkgroupSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      workgroup: "ninguno",
    });

    expect(result.success).toBe(true);
  });

  it("rejects an invalid workgroup value", () => {
    const result = setMemberWorkgroupSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      workgroup: "cocina",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid uuid", () => {
    const result = setMemberWorkgroupSchema.safeParse({
      userId: "not-a-uuid",
      workgroup: "telas",
    });

    expect(result.success).toBe(false);
  });
});

describe("setMemberActiveSchema", () => {
  it("accepts a valid uuid and boolean", () => {
    const result = setMemberActiveSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      isActive: false,
    });

    expect(result.success).toBe(true);
  });

  it("rejects a non-boolean isActive value", () => {
    const result = setMemberActiveSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      isActive: "false",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid uuid", () => {
    const result = setMemberActiveSchema.safeParse({
      userId: "not-a-uuid",
      isActive: true,
    });

    expect(result.success).toBe(false);
  });
});
