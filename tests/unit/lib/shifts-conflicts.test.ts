import { describe, expect, it } from "vitest";
import { shiftsOverlap } from "@/lib/shifts/queries";

describe("shiftsOverlap", () => {
  it("returns true for partially overlapping shifts (A starts before B ends, A ends after B starts)", () => {
    const result = shiftsOverlap(
      { startTime: "2026-08-15T10:00:00Z", endTime: "2026-08-15T12:00:00Z" },
      { startTime: "2026-08-15T11:00:00Z", endTime: "2026-08-15T13:00:00Z" },
    );
    expect(result).toBe(true);
  });

  it("returns false for adjacent shifts (no overlap, A ends exactly when B starts)", () => {
    const result = shiftsOverlap(
      { startTime: "2026-08-15T10:00:00Z", endTime: "2026-08-15T12:00:00Z" },
      { startTime: "2026-08-15T12:00:00Z", endTime: "2026-08-15T14:00:00Z" },
    );
    expect(result).toBe(false);
  });

  it("returns false when A ends before B starts", () => {
    const result = shiftsOverlap(
      { startTime: "2026-08-15T10:00:00Z", endTime: "2026-08-15T12:00:00Z" },
      { startTime: "2026-08-15T12:01:00Z", endTime: "2026-08-15T14:00:00Z" },
    );
    expect(result).toBe(false);
  });

  it("returns true when A contains B entirely", () => {
    const result = shiftsOverlap(
      { startTime: "2026-08-15T10:00:00Z", endTime: "2026-08-15T14:00:00Z" },
      { startTime: "2026-08-15T11:00:00Z", endTime: "2026-08-15T12:00:00Z" },
    );
    expect(result).toBe(true);
  });

  it("returns true when B contains A entirely", () => {
    const result = shiftsOverlap(
      { startTime: "2026-08-15T11:00:00Z", endTime: "2026-08-15T12:00:00Z" },
      { startTime: "2026-08-15T10:00:00Z", endTime: "2026-08-15T14:00:00Z" },
    );
    expect(result).toBe(true);
  });

  it("returns true for exactly the same time range", () => {
    const result = shiftsOverlap(
      { startTime: "2026-08-15T10:00:00Z", endTime: "2026-08-15T12:00:00Z" },
      { startTime: "2026-08-15T10:00:00Z", endTime: "2026-08-15T12:00:00Z" },
    );
    expect(result).toBe(true);
  });

  it("returns false for completely separate time ranges", () => {
    const result = shiftsOverlap(
      { startTime: "2026-08-15T10:00:00Z", endTime: "2026-08-15T12:00:00Z" },
      { startTime: "2026-08-16T10:00:00Z", endTime: "2026-08-16T12:00:00Z" },
    );
    expect(result).toBe(false);
  });

  it("returns true when A starts before B ends, even by a millisecond", () => {
    const result = shiftsOverlap(
      { startTime: "2026-08-15T10:00:00Z", endTime: "2026-08-15T12:00:00Z" },
      { startTime: "2026-08-15T11:59:59Z", endTime: "2026-08-15T13:00:00Z" },
    );
    expect(result).toBe(true);
  });
});
