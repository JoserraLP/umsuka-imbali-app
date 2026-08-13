import { describe, it, expect } from "vitest";
import { memberFiltersSchema } from "@/lib/members/schema";

describe("memberFiltersSchema", () => {
  it("parses a full set of valid filters", () => {
    const result = memberFiltersSchema.safeParse({
      workgroup: "telas",
      componentType: "music",
      status: "pending",
      q: "ana",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        workgroup: "telas",
        componentType: "music",
        status: "pending",
        q: "ana",
      });
    }
  });

  it("parses empty params into defaults (all filters unset)", () => {
    const result = memberFiltersSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.workgroup).toBeUndefined();
      expect(result.data.componentType).toBeUndefined();
      expect(result.data.status).toBeUndefined();
      expect(result.data.q).toBeUndefined();
    }
  });

  it("trims the q parameter", () => {
    const result = memberFiltersSchema.safeParse({ q: "  Ana  " });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBe("Ana");
    }
  });

  it("normalizes an empty q string to undefined", () => {
    const result = memberFiltersSchema.safeParse({ q: "   " });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.q).toBeUndefined();
    }
  });

  it("rejects an invalid workgroup value", () => {
    const result = memberFiltersSchema.safeParse({ workgroup: "grupo-fantasma" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid componentType value", () => {
    const result = memberFiltersSchema.safeParse({ componentType: "percusion" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid status value", () => {
    const result = memberFiltersSchema.safeParse({ status: "banished" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-string q value", () => {
    const result = memberFiltersSchema.safeParse({ q: 42 });
    expect(result.success).toBe(false);
  });

  it("accepts each valid workgroup value", () => {
    for (const workgroup of ["telas", "barra", "estandarte", "limpieza", "ninguno"]) {
      expect(memberFiltersSchema.safeParse({ workgroup }).success).toBe(true);
    }
  });

  it("accepts each valid componentType value", () => {
    for (const componentType of ["music", "dance", "member"]) {
      expect(memberFiltersSchema.safeParse({ componentType }).success).toBe(true);
    }
  });

  it("accepts each valid status value", () => {
    for (const status of ["pending", "active", "suspended"]) {
      expect(memberFiltersSchema.safeParse({ status }).success).toBe(true);
    }
  });
});
