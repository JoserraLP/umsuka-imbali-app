import { describe, it, expect } from "vitest";
import {
  computeRate,
  computeStreaks,
  computeMonthlyTrend,
  buildPersonalStats,
  computeDelta,
  type ActivityMark,
} from "@/lib/stats/stats";

const NOW = new Date("2026-08-15T12:00:00");

function mark(date: string, attended: boolean): ActivityMark {
  return { date, attended };
}

// ── computeRate ───────────────────────────────────────

describe("computeRate", () => {
  it("returns null when total is zero or negative", () => {
    expect(computeRate(0, 0)).toBeNull();
    expect(computeRate(3, -1)).toBeNull();
  });

  it("returns 0 when nothing was attended", () => {
    expect(computeRate(0, 5)).toBe(0);
  });

  it("returns 100 when everything was attended", () => {
    expect(computeRate(4, 4)).toBe(100);
  });

  it("rounds to one decimal (2 of 3 = 66.7)", () => {
    expect(computeRate(2, 3)).toBe(66.7);
    expect(computeRate(1, 3)).toBe(33.3);
  });
});

// ── computeStreaks ────────────────────────────────────

describe("computeStreaks", () => {
  it("returns zeros for an empty list", () => {
    expect(computeStreaks([])).toEqual({ current: 0, best: 0 });
  });

  it("makes current equal best when every mark was attended", () => {
    const marks = [
      mark("2026-01-01", true),
      mark("2026-01-05", true),
      mark("2026-01-09", true),
    ];
    expect(computeStreaks(marks)).toEqual({ current: 3, best: 3 });
  });

  it("resets current to 0 while preserving best when the last mark is missed", () => {
    const marks = [
      mark("2026-01-01", true),
      mark("2026-01-02", true),
      mark("2026-01-03", true),
      mark("2026-01-04", false),
    ];
    expect(computeStreaks(marks)).toEqual({ current: 0, best: 3 });
  });

  it("counts the running streak after a miss", () => {
    const marks = [
      mark("2026-01-01", true),
      mark("2026-01-02", true),
      mark("2026-01-03", false),
      mark("2026-01-04", true),
    ];
    expect(computeStreaks(marks)).toEqual({ current: 1, best: 2 });
  });

  it("sorts unordered input internally by date", () => {
    const marks = [
      mark("2026-03-01", true),
      mark("2026-01-01", false),
      mark("2026-02-01", true),
      mark("2026-04-01", true),
    ];
    // Sorted: miss, attend, attend, attend → current 3, best 3.
    expect(computeStreaks(marks)).toEqual({ current: 3, best: 3 });
  });

  it("keeps one streak across a year wrap (Dec 31 → Jan 2)", () => {
    const marks = [mark("2025-12-31", true), mark("2026-01-02", true)];
    expect(computeStreaks(marks)).toEqual({ current: 2, best: 2 });
  });

  it("reports a single max when two runs tie", () => {
    const marks = [
      mark("2026-01-01", true),
      mark("2026-01-02", true),
      mark("2026-02-01", false),
      mark("2026-03-01", true),
      mark("2026-03-02", true),
    ];
    expect(computeStreaks(marks)).toEqual({ current: 2, best: 2 });
  });
});

// ── computeMonthlyTrend ───────────────────────────────

describe("computeMonthlyTrend", () => {
  it("produces exactly N buckets oldest → newest ending at the current month", () => {
    const trend = computeMonthlyTrend([], { now: NOW });
    expect(trend.map((point) => point.key)).toEqual([
      "2026-03",
      "2026-04",
      "2026-05",
      "2026-06",
      "2026-07",
      "2026-08",
    ]);
    expect(trend.map((point) => point.label)).toEqual([
      "mar",
      "abr",
      "may",
      "jun",
      "jul",
      "ago",
    ]);
  });

  it("defaults to 6 buckets ending at the real current month", () => {
    const trend = computeMonthlyTrend([]);
    expect(trend).toHaveLength(6);
    const last = trend[trend.length - 1]!;
    const now = new Date();
    expect(last.key).toBe(
      `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    );
  });

  it("honours a custom month count", () => {
    const trend = computeMonthlyTrend([], { months: 3, now: NOW });
    expect(trend.map((point) => point.key)).toEqual(["2026-06", "2026-07", "2026-08"]);
  });

  it("ignores marks outside the window", () => {
    const marks = [mark("2025-01-10", true), mark("2024-06-01", false)];
    const trend = computeMonthlyTrend(marks, { now: NOW });
    expect(trend.every((point) => point.rate === null)).toBe(true);
  });

  it("zero-fills empty buckets with a null rate and aggregates matching ones", () => {
    const marks = [
      mark("2026-05-03", true),
      mark("2026-05-17", false),
      mark("2026-05-20", true),
      mark("2026-08-02", false),
    ];
    const trend = computeMonthlyTrend(marks, { now: NOW });
    expect(trend.map((point) => point.rate)).toEqual([null, null, 66.7, null, null, 0]);
  });
});

// ── buildPersonalStats ────────────────────────────────

describe("buildPersonalStats", () => {
  it("builds per-source rates, overall rate, streaks and trend", () => {
    const stats = buildPersonalStats(
      [mark("2026-05-01", true), mark("2026-06-01", false)],
      [mark("2026-07-01", true)],
      [mark("2026-08-01", true)],
      { now: NOW },
    );

    expect(stats.eventRate).toBe(50);
    expect(stats.rehearsalRate).toBe(100);
    expect(stats.shiftRate).toBe(100);
    expect(stats.overallRate).toBe(75); // 3 of 4 combined
    expect(stats.streaks).toEqual({ current: 2, best: 2 }); // A,F,A,A by date
    expect(stats.trend).toHaveLength(6);
  });

  it("passes months and now through to the trend", () => {
    const stats = buildPersonalStats([], [], [], { months: 12, now: NOW });
    expect(stats.trend).toHaveLength(12);
    expect(stats.trend[0]!.key).toBe("2025-09");
  });

  it("handles an all-empty input", () => {
    const stats = buildPersonalStats([], [], []);
    expect(stats.eventRate).toBeNull();
    expect(stats.rehearsalRate).toBeNull();
    expect(stats.shiftRate).toBeNull();
    expect(stats.overallRate).toBeNull();
    expect(stats.streaks).toEqual({ current: 0, best: 0 });
    expect(stats.trend).toHaveLength(6);
    expect(stats.trend.every((point) => point.rate === null)).toBe(true);
  });
});

// ── computeDelta ──────────────────────────────────────

describe("computeDelta", () => {
  it("returns null when either side is null", () => {
    expect(computeDelta(null, 50)).toBeNull();
    expect(computeDelta(50, null)).toBeNull();
    expect(computeDelta(null, null)).toBeNull();
  });

  it("subtracts b from a rounded to one decimal, allowing negatives", () => {
    expect(computeDelta(72.4, 65.9)).toBe(6.5);
    expect(computeDelta(50, 55.7)).toBe(-5.7);
    expect(computeDelta(66.7, 66.7)).toBe(0);
    expect(computeDelta(66.7, 66.6)).toBe(0.1);
  });
});
