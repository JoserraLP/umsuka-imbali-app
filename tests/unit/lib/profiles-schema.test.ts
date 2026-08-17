import { describe, expect, it } from "vitest";
import {
  updateOwnProfileSchema,
  updateMemberRoleSchema,
  updateMemberProfileSchema,
  setMemberActiveSchema,
  setMemberWorkgroupSchema,
  normalizeSkills,
  isAllowedAvatarUrl,
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

  it("accepts a bio up to 500 characters and trims it", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      bio: "  Bailarina desde 2010.  ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bio).toBe("Bailarina desde 2010.");
    }
  });

  it("coerces an empty bio to null", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      bio: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bio).toBeNull();
    }
  });

  it("rejects a bio longer than 500 characters", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      bio: "x".repeat(501),
    });

    expect(result.success).toBe(false);
  });

  it("accepts a valid phone number and trims it", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      phone: "  +34 600 123 456  ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBe("+34 600 123 456");
    }
  });

  it("coerces an empty phone to null", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      phone: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.phone).toBeNull();
    }
  });

  it("rejects a phone with letters or an invalid length", () => {
    const letters = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      phone: "abc123",
    });
    expect(letters.success).toBe(false);

    const tooShort = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      phone: "123",
    });
    expect(tooShort.success).toBe(false);

    const tooLong = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      phone: "1".repeat(21),
    });
    expect(tooLong.success).toBe(false);
  });

  it("normalizes skills: trim and dedupe case-insensitively", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      skills: [" Baile ", "baile", "  Música  ", "Baile"],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skills).toEqual(["Baile", "Música"]);
    }
  });

  it("rejects an empty or whitespace-only skill", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      skills: ["Baile", ""],
    });

    expect(result.success).toBe(false);
  });

  it("defaults skills to an empty array when omitted", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.skills).toEqual([]);
    }
  });

  it("rejects more than 10 skills", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      skills: Array.from({ length: 11 }, (_, index) => `habilidad ${index}`),
    });

    expect(result.success).toBe(false);
  });

  it("rejects a skill longer than 50 characters", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      skills: ["x".repeat(51)],
    });

    expect(result.success).toBe(false);
  });

  it("accepts an https avatar URL from an allowlisted host", () => {
    const google = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      avatarUrl: "https://lh3.googleusercontent.com/a/abc123",
    });
    expect(google.success).toBe(true);

    const supabaseSubdomain = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      avatarUrl: "https://xyz.supabase.co/storage/v1/object/public/avatars/a.png",
    });
    expect(supabaseSubdomain.success).toBe(true);

    const unsplash = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      avatarUrl: "https://images.unsplash.com/photo-123",
    });
    expect(unsplash.success).toBe(true);
  });

  it("rejects http, non-allowlisted and unparsable avatar URLs", () => {
    const http = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      avatarUrl: "http://lh3.googleusercontent.com/a/abc123",
    });
    expect(http.success).toBe(false);

    const evilHost = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      avatarUrl: "https://evil.example.com/a.png",
    });
    expect(evilHost.success).toBe(false);

    const garbled = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      avatarUrl: "not-a-url",
    });
    expect(garbled.success).toBe(false);
  });

  it("coerces an empty avatar URL to null", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      avatarUrl: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.avatarUrl).toBeNull();
    }
  });

  it("accepts a valid joined_at date and trims it", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      joinedAt: " 2020-05-01 ",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.joinedAt).toBe("2020-05-01");
    }
  });

  it("coerces an empty joined_at to null", () => {
    const result = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      joinedAt: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.joinedAt).toBeNull();
    }
  });

  it("rejects an unparsable or future joined_at date", () => {
    const unparsable = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      joinedAt: "not-a-date",
    });
    expect(unparsable.success).toBe(false);

    const future = updateOwnProfileSchema.safeParse({
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      joinedAt: "2099-01-01",
    });
    expect(future.success).toBe(false);
  });
});

describe("normalizeSkills", () => {
  it("trims, drops empty items and dedupes case-insensitively", () => {
    expect(normalizeSkills([" Baile ", "BAILE", "", " música ", "Baile"])).toEqual([
      "Baile",
      "música",
    ]);
  });

  it("caps the result at 10 items keeping the first occurrences", () => {
    const items = Array.from({ length: 15 }, (_, index) => `habilidad ${index}`);
    const result = normalizeSkills(items);
    expect(result).toHaveLength(10);
    expect(result[0]).toBe("habilidad 0");
    expect(result[9]).toBe("habilidad 9");
  });

  it("returns an empty array for empty input", () => {
    expect(normalizeSkills([])).toEqual([]);
    expect(normalizeSkills(["", "  "])).toEqual([]);
  });
});

describe("isAllowedAvatarUrl", () => {
  it("accepts https URLs from allowlisted hosts and supabase.co subdomains", () => {
    expect(isAllowedAvatarUrl("https://lh3.googleusercontent.com/a/1")).toBe(true);
    expect(isAllowedAvatarUrl("https://images.unsplash.com/photo-1")).toBe(true);
    expect(isAllowedAvatarUrl("https://supabase.co/x.png")).toBe(true);
    expect(isAllowedAvatarUrl("https://project.supabase.co/storage/v1/x.png")).toBe(true);
  });

  it("rejects http, wrong hosts and malformed values", () => {
    expect(isAllowedAvatarUrl("http://lh3.googleusercontent.com/a/1")).toBe(false);
    expect(isAllowedAvatarUrl("https://evil.com/a.png")).toBe(false);
    expect(isAllowedAvatarUrl("https://supabase.co.evil.com/a.png")).toBe(false);
    expect(isAllowedAvatarUrl("not-a-url")).toBe(false);
    expect(isAllowedAvatarUrl("")).toBe(false);
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

  it("inherits the enriched fields from updateOwnProfileSchema", () => {
    const result = updateMemberProfileSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      bio: "Bailarina.",
      phone: "+34 600 123 456",
      skills: ["Baile", "Baile", "costura"],
      avatarUrl: "https://lh3.googleusercontent.com/a/1",
      joinedAt: "2019-03-10",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.bio).toBe("Bailarina.");
      expect(result.data.phone).toBe("+34 600 123 456");
      expect(result.data.skills).toEqual(["Baile", "costura"]);
      expect(result.data.avatarUrl).toBe("https://lh3.googleusercontent.com/a/1");
      expect(result.data.joinedAt).toBe("2019-03-10");
    }
  });

  it("still validates the enriched-field rules on the admin path", () => {
    const badPhone = updateMemberProfileSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      phone: "abc",
    });
    expect(badPhone.success).toBe(false);

    const badAvatar = updateMemberProfileSchema.safeParse({
      userId: "123e4567-e89b-12d3-a456-426614174000",
      firstName: "Ana",
      lastName: "García",
      componentType: "member",
      avatarUrl: "https://evil.example.com/a.png",
    });
    expect(badAvatar.success).toBe(false);
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
