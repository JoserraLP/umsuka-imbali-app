// ── Voting business rules (pure functions, no DB access) ──

export interface VotingState {
  is_open: boolean;
  voting_deadline: string | null;
}

export interface VotingResultsRow {
  optionId: string;
  optionText: string;
  votes: number;
  totalVotes: number;
  percentage: number;
}

interface VotingOptionInput {
  id: string;
  option_text: string;
}

interface VotingVoteInput {
  option_id: string;
}

/**
 * Normalizes a raw deadline input into an unambiguous ISO string.
 *
 * `datetime-local` inputs produce values like `"2026-03-01T23:59"` — no
 * seconds, no timezone offset — which the ISO-8601 schema validation
 * rejects. The conversion must happen in the browser (user's local
 * timezone), mirroring `src/app/events/event-form.tsx`. Unparseable
 * values are passed through unchanged so the schema produces its own
 * validation error instead of silently dropping the deadline.
 */
export function normalizeDeadlineInput(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString();
}

/**
 * A voting is effectively open when it is flagged open AND either has no
 * deadline or the deadline is still in the future.
 */
export function isVotingOpenEffective(
  voting: VotingState,
  now: Date,
): boolean {
  if (!voting.is_open) return false;
  if (!voting.voting_deadline) return true;
  return new Date(voting.voting_deadline).getTime() > now.getTime();
}

/**
 * Results are visible when the voting is no longer effectively open, the
 * caller has already voted, or the caller is management. Any open voting
 * hides results from members who have not voted yet.
 */
export function canViewResults(
  voting: VotingState,
  hasVoted: boolean,
  isManagement: boolean,
  now: Date,
): boolean {
  if (!isVotingOpenEffective(voting, now)) return true;
  if (hasVoted) return true;
  if (isManagement) return true;
  return false;
}

/**
 * Computes per-option vote counts and percentages (one decimal place).
 * Options without votes are included with 0 votes / 0%.
 */
export function computeResults(
  options: VotingOptionInput[],
  votes: VotingVoteInput[],
): VotingResultsRow[] {
  const totalVotes = votes.length;

  const counts = new Map<string, number>();
  for (const vote of votes) {
    counts.set(vote.option_id, (counts.get(vote.option_id) ?? 0) + 1);
  }

  return options.map((option) => {
    const count = counts.get(option.id) ?? 0;
    const percentage =
      totalVotes > 0 ? Math.round((count * 1000) / totalVotes) / 10 : 0;

    return {
      optionId: option.id,
      optionText: option.option_text,
      votes: count,
      totalVotes,
      percentage,
    };
  });
}