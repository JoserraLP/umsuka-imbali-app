/**
 * Pure helpers for rehearsal participation statistics.
 *
 * Participation for a member on an event = attended sessions / marked
 * sessions * 100, rounded to 1 decimal. Returns null when no sessions
 * have been marked yet so the UI can render "—" instead of a fake 0%.
 */

export interface SessionMark {
  session: "morning" | "afternoon";
  attended: boolean;
}

/**
 * Computes attendance percentage over the marked sessions.
 * Returns null when `marks` is empty (nothing marked yet).
 */
export function computeRehearsalParticipation(marks: SessionMark[]): number | null {
  if (marks.length === 0) {
    return null;
  }

  const attended = marks.filter((mark) => mark.attended).length;
  return computeParticipationFromCounts(attended, marks.length);
}

/**
 * Count-based variant used by the profile/member pages where only the
 * aggregates are available (head-count queries).
 * Returns null when `marked` is 0 (nothing marked yet).
 */
export function computeParticipationFromCounts(
  attended: number,
  marked: number,
): number | null {
  if (marked <= 0) {
    return null;
  }

  return Math.round((attended / marked) * 1000) / 10;
}
