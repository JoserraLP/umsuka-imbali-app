/**
 * Pure helpers for the personal statistics section (/profile/stats).
 *
 * Everything here works on plain `ActivityMark` lists so it stays free of
 * Supabase imports and is trivially unit-testable. Rates are percentages
 * rounded to 1 decimal; a rate is null when nothing has been marked yet
 * so the UI can render "—" instead of a fake 0%.
 */

/** One attendance mark with a resolvable ISO date. */
export interface ActivityMark {
  date: string;
  attended: boolean;
}

/** Current (running) and best consecutive-attended-mark streaks. */
export interface Streaks {
  current: number;
  best: number;
}

/** One month bucket of the trend chart, oldest → newest. */
export interface MonthlyTrendPoint {
  /** Bucket key, "YYYY-MM". */
  key: string;
  /** Static es-ES short label, e.g. "ene". */
  label: string;
  /** Attendance rate for the month; null when nothing was marked. */
  rate: number | null;
}

/** Full personal stats block consumed by /profile/stats. */
export interface PersonalStats {
  eventRate: number | null;
  rehearsalRate: number | null;
  shiftRate: number | null;
  overallRate: number | null;
  streaks: Streaks;
  trend: MonthlyTrendPoint[];
}

export interface BuildPersonalStatsOptions {
  /** Month buckets to build (default 6). */
  months?: number;
  /** Injectable clock for tests. */
  now?: Date;
}

/** Static es-ES month labels, indexed 0 = January. */
const MONTH_LABELS = [
  "ene",
  "feb",
  "mar",
  "abr",
  "may",
  "jun",
  "jul",
  "ago",
  "sep",
  "oct",
  "nov",
  "dic",
] as const;

/**
 * Percentage of attended over total, rounded to 1 decimal.
 * Returns null when total <= 0 (nothing marked yet).
 */
export function computeRate(attended: number, total: number): number | null {
  if (total <= 0) {
    return null;
  }
  return Math.round((attended / total) * 1000) / 10;
}

/**
 * Consecutive attended marks in chronological order: `current` counts the
 * run ending at the last mark (0 when that mark was missed) and `best`
 * the longest run ever. Streaks count marks, not calendar days — a gap
 * between activities does not break one.
 */
export function computeStreaks(marks: ActivityMark[]): Streaks {
  const sorted = [...marks].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  let current = 0;
  let best = 0;

  for (const mark of sorted) {
    if (mark.attended) {
      current += 1;
      best = Math.max(best, current);
    } else {
      current = 0;
    }
  }

  return { current, best };
}

function bucketKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

/**
 * Builds `months` (default 6) monthly buckets oldest → newest ending at
 * the current month, aggregating marks by their date's "YYYY-MM" prefix.
 * Marks outside the window are ignored; empty buckets get a null rate so
 * the chart can render them as "no data" instead of 0%.
 */
export function computeMonthlyTrend(
  marks: ActivityMark[],
  options: BuildPersonalStatsOptions = {},
): MonthlyTrendPoint[] {
  const months = options.months ?? 6;
  const now = options.now ?? new Date();

  const points: MonthlyTrendPoint[] = [];
  const totalsByKey = new Map<string, { attended: number; total: number }>();

  for (let i = months - 1; i >= 0; i -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
    points.push({
      key: bucketKey(date),
      label: MONTH_LABELS[date.getMonth()]!,
      rate: null,
    });
  }

  for (const mark of marks) {
    const key = mark.date.slice(0, 7);
    if (!points.some((point) => point.key === key)) {
      continue; // Outside the window.
    }
    const totals = totalsByKey.get(key) ?? { attended: 0, total: 0 };
    totals.total += 1;
    if (mark.attended) {
      totals.attended += 1;
    }
    totalsByKey.set(key, totals);
  }

  for (const point of points) {
    const totals = totalsByKey.get(point.key);
    if (totals) {
      point.rate = computeRate(totals.attended, totals.total);
    }
  }

  return points;
}

/**
 * Aggregates the three activity sources into the full personal stats
 * block: per-source rates, an overall rate over all marks combined,
 * streaks across every mark and the monthly trend of the combination.
 */
export function buildPersonalStats(
  eventMarks: ActivityMark[],
  rehearsalMarks: ActivityMark[],
  shiftMarks: ActivityMark[],
  options: BuildPersonalStatsOptions = {},
): PersonalStats {
  const allMarks = [...eventMarks, ...rehearsalMarks, ...shiftMarks];
  const attendedCount = (marks: ActivityMark[]) =>
    marks.filter((mark) => mark.attended).length;

  return {
    eventRate: computeRate(attendedCount(eventMarks), eventMarks.length),
    rehearsalRate: computeRate(attendedCount(rehearsalMarks), rehearsalMarks.length),
    shiftRate: computeRate(attendedCount(shiftMarks), shiftMarks.length),
    overallRate: computeRate(attendedCount(allMarks), allMarks.length),
    streaks: computeStreaks(allMarks),
    trend: computeMonthlyTrend(allMarks, options),
  };
}

/**
 * Difference between two percentages in percentage points, rounded to
 * 1 decimal. Returns null when either side is unknown ("—" in the UI).
 */
export function computeDelta(a: number | null, b: number | null): number | null {
  if (a === null || b === null) {
    return null;
  }
  return Math.round((a - b) * 10) / 10;
}
