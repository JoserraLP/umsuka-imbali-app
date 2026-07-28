export interface CalendarDay {
  date: Date;
  inCurrentMonth: boolean;
}

/**
 * Builds a Monday-first month grid as an array of complete weeks (7 days
 * each), including leading/trailing days from adjacent months so every
 * week is full. `month` is 1-indexed (1 = January), matching how it's
 * used in the /calendar route's query params.
 */
export function buildMonthGrid(year: number, month: number): CalendarDay[][] {
  const daysInMonth = new Date(year, month, 0).getDate();
  const firstOfMonth = new Date(year, month - 1, 1);
  // getDay() is Sun=0..Sat=6; convert to a Monday-first offset (Mon=0..Sun=6).
  const leadingDays = (firstOfMonth.getDay() + 6) % 7;
  const totalCells = Math.ceil((leadingDays + daysInMonth) / 7) * 7;

  const cells: CalendarDay[] = [];
  for (let i = 0; i < totalCells; i++) {
    const date = new Date(year, month - 1, 1 - leadingDays + i);
    cells.push({ date, inCurrentMonth: date.getMonth() === month - 1 });
  }

  const weeks: CalendarDay[][] = [];
  for (let i = 0; i < cells.length; i += 7) {
    weeks.push(cells.slice(i, i + 7));
  }
  return weeks;
}

/**
 * Returns the [from, to) ISO range covering a whole calendar month, in
 * the server's local timezone. `to` is exclusive (the first instant of
 * the *next* month), so it composes directly with `.lt()` in queries.
 *
 * Simplification: this uses the server's local timezone, not each
 * viewer's. For a single-country association this is an acceptable
 * approximation; a fully timezone-aware boundary would need a
 * per-association timezone setting, which is out of scope here.
 */
export function monthDateRange(year: number, month: number): { from: string; to: string } {
  const from = new Date(year, month - 1, 1);
  const to = new Date(year, month, 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

/** Groups a Date into the same "day key" format used by buildMonthGrid's cells, for map lookups. */
export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}
