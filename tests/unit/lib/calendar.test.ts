import { describe, expect, it } from "vitest";
import { buildMonthGrid, monthDateRange, dayKey } from "@/lib/events/calendar";

describe("buildMonthGrid", () => {
  it("produces complete weeks of 7 days each", () => {
    const weeks = buildMonthGrid(2026, 8);
    for (const week of weeks) {
      expect(week).toHaveLength(7);
    }
  });

  it("starts each week on Monday", () => {
    const weeks = buildMonthGrid(2026, 8);
    for (const week of weeks) {
      // getDay(): Mon=1
      expect(week[0]!.date.getDay()).toBe(1);
    }
  });

  it("includes every day of the target month exactly once, marked inCurrentMonth", () => {
    const year = 2026;
    const month = 2; // February 2026 has 28 days
    const weeks = buildMonthGrid(year, month);
    const daysInMonthCells = weeks.flat().filter((day) => day.inCurrentMonth);

    expect(daysInMonthCells).toHaveLength(28);
    expect(daysInMonthCells[0]!.date.getDate()).toBe(1);
    expect(daysInMonthCells[daysInMonthCells.length - 1]!.date.getDate()).toBe(28);
  });

  it("marks leading/trailing days from adjacent months as not inCurrentMonth", () => {
    // August 2026: Aug 1 is a Saturday, so there are leading July days.
    const weeks = buildMonthGrid(2026, 8);
    const firstWeek = weeks[0]!;
    const leadingDays = firstWeek.filter((day) => !day.inCurrentMonth);

    expect(leadingDays.length).toBeGreaterThan(0);
    for (const day of leadingDays) {
      expect(day.date.getMonth()).toBe(6); // July (0-indexed)
    }
  });

  it("handles a month that spans exactly 5 weeks without an extra empty row", () => {
    // April 2026: 1st is a Wednesday, 30 days -> fits in 5 weeks exactly.
    const weeks = buildMonthGrid(2026, 4);
    expect(weeks).toHaveLength(5);
  });
});

describe("monthDateRange", () => {
  it("returns a [from, to) range spanning exactly one month", () => {
    const { from, to } = monthDateRange(2026, 8);
    const fromDate = new Date(from);
    const toDate = new Date(to);

    expect(fromDate.getFullYear()).toBe(2026);
    expect(fromDate.getMonth()).toBe(7); // August (0-indexed)
    expect(fromDate.getDate()).toBe(1);

    expect(toDate.getFullYear()).toBe(2026);
    expect(toDate.getMonth()).toBe(8); // September (0-indexed) — exclusive upper bound
    expect(toDate.getDate()).toBe(1);
  });

  it("rolls over correctly from December to January", () => {
    const { to } = monthDateRange(2026, 12);
    const toDate = new Date(to);

    expect(toDate.getFullYear()).toBe(2027);
    expect(toDate.getMonth()).toBe(0); // January
  });
});

describe("dayKey", () => {
  it("produces the same key for two Date objects representing the same day", () => {
    const a = new Date(2026, 7, 15, 9, 0);
    const b = new Date(2026, 7, 15, 21, 45);
    expect(dayKey(a)).toBe(dayKey(b));
  });

  it("produces different keys for different days", () => {
    const a = new Date(2026, 7, 15);
    const b = new Date(2026, 7, 16);
    expect(dayKey(a)).not.toBe(dayKey(b));
  });
});
