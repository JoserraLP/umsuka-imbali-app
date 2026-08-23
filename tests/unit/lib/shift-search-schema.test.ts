import { describe, it, expect } from "vitest";
import {
  escapeIlikePattern,
  shiftMemberSearchSchema,
  SHIFT_MEMBER_SEARCH_DEFAULT_PAGE,
  SHIFT_MEMBER_SEARCH_DEFAULT_PAGE_SIZE,
  SHIFT_MEMBER_SEARCH_MAX_PAGE_SIZE,
} from "@/lib/shifts/search";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("escapeIlikePattern", () => {
  it("escapes backslashes before any other character", () => {
    expect(escapeIlikePattern("back\\slash")).toBe("back\\\\slash");
  });

  it("escapes % wildcards", () => {
    expect(escapeIlikePattern("50%")).toBe("50\\%");
  });

  it("escapes _ wildcards", () => {
    expect(escapeIlikePattern("a_b")).toBe("a\\_b");
  });

  it("escapes combined special characters in a single pass", () => {
    expect(escapeIlikePattern("a_\\b%c")).toBe("a\\_\\\\b\\%c");
  });

  it("leaves plain text untouched", () => {
    expect(escapeIlikePattern("Ana García-López")).toBe("Ana García-López");
  });
});

describe("shiftMemberSearchSchema", () => {
  it("parses minimal input applying pagination defaults", () => {
    const parsed = shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "ana" });

    expect(parsed.shiftId).toBe(VALID_UUID);
    expect(parsed.query).toBe("ana");
    expect(parsed.workgroup).toBeUndefined();
    expect(parsed.page).toBe(SHIFT_MEMBER_SEARCH_DEFAULT_PAGE);
    expect(parsed.pageSize).toBe(SHIFT_MEMBER_SEARCH_DEFAULT_PAGE_SIZE);
  });

  it("trims surrounding whitespace from the query", () => {
    const parsed = shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "  ana  " });

    expect(parsed.query).toBe("ana");
  });

  it("rejects an empty query", () => {
    expect(() =>
      shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "" }),
    ).toThrow();
  });

  it("rejects a whitespace-only query (min length applies after trim)", () => {
    expect(() =>
      shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "   " }),
    ).toThrow();
  });

  it("accepts a query of exactly 100 characters", () => {
    const parsed = shiftMemberSearchSchema.parse({
      shiftId: VALID_UUID,
      query: "a".repeat(100),
    });

    expect(parsed.query).toHaveLength(100);
  });

  it("rejects a query longer than 100 characters", () => {
    expect(() =>
      shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "a".repeat(101) }),
    ).toThrow();
  });

  it("rejects a non-UUID shiftId", () => {
    expect(() =>
      shiftMemberSearchSchema.parse({ shiftId: "not-a-uuid", query: "ana" }),
    ).toThrow();
  });

  it.each(["telas", "barra", "estandarte", "limpieza"] as const)(
    "accepts the active workgroup filter %s",
    (workgroup) => {
      const parsed = shiftMemberSearchSchema.parse({
        shiftId: VALID_UUID,
        query: "ana",
        workgroup,
      });

      expect(parsed.workgroup).toBe(workgroup);
    },
  );

  it("accepts null and undefined as workgroup (no filter)", () => {
    expect(
      shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "ana", workgroup: null })
        .workgroup,
    ).toBeNull();
    expect(
      shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "ana" }).workgroup,
    ).toBeUndefined();
  });

  it("rejects values outside the active workgroup enum", () => {
    expect(() =>
      shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "ana", workgroup: "ninguno" }),
    ).toThrow();
    expect(() =>
      shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "ana", workgroup: "cocina" }),
    ).toThrow();
  });

  it("clamps page below the minimum to 1 and keeps valid pages", () => {
    expect(
      shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "ana", page: 0 }).page,
    ).toBe(1);
    expect(
      shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "ana", page: -5 }).page,
    ).toBe(1);
    expect(
      shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "ana", page: 3 }).page,
    ).toBe(3);
  });

  it("clamps pageSize to the [1, max] range", () => {
    expect(
      shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "ana", pageSize: 0 }).pageSize,
    ).toBe(1);
    expect(
      shiftMemberSearchSchema.parse({
        shiftId: VALID_UUID,
        query: "ana",
        pageSize: SHIFT_MEMBER_SEARCH_MAX_PAGE_SIZE * 10,
      }).pageSize,
    ).toBe(SHIFT_MEMBER_SEARCH_MAX_PAGE_SIZE);
    expect(
      shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "ana", pageSize: 10 }).pageSize,
    ).toBe(10);
  });

  it("rejects non-integer pagination values", () => {
    expect(() =>
      shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "ana", page: 1.5 }),
    ).toThrow();
    expect(() =>
      shiftMemberSearchSchema.parse({ shiftId: VALID_UUID, query: "ana", pageSize: 2.5 }),
    ).toThrow();
  });
});
