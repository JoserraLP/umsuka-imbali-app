import { describe, it, expect } from "vitest";
import {
  isVotingOpenEffective,
  canViewResults,
  computeResults,
  normalizeDeadlineInput,
  type VotingState,
} from "@/lib/votings/logic";

const NOW = new Date("2026-03-01T12:00:00Z");

function voting(overrides: Partial<VotingState> = {}): VotingState {
  return { is_open: true, voting_deadline: null, ...overrides };
}

// ── normalizeDeadlineInput ─────────────────────────────

describe("normalizeDeadlineInput", () => {
  it("returns null for empty or missing input", () => {
    expect(normalizeDeadlineInput(null)).toBeNull();
    expect(normalizeDeadlineInput(undefined)).toBeNull();
    expect(normalizeDeadlineInput("")).toBeNull();
  });

  it("converts a raw datetime-local value into a full ISO string", () => {
    const result = normalizeDeadlineInput("2099-01-01T23:59");
    expect(result).toBe(new Date("2099-01-01T23:59").toISOString());
    expect(result).toMatch(/Z$/);
  });

  it("returns full ISO strings unchanged (canonical form)", () => {
    expect(normalizeDeadlineInput("2099-01-01T00:00:00Z")).toBe(
      "2099-01-01T00:00:00.000Z",
    );
  });

  it("passes through unparseable values so the schema can reject them", () => {
    expect(normalizeDeadlineInput("not-a-date")).toBe("not-a-date");
    expect(normalizeDeadlineInput("2026-99-99T99:99:99")).toBe(
      "2026-99-99T99:99:99",
    );
  });
});

// ── isVotingOpenEffective ───────────────────────────────

describe("isVotingOpenEffective", () => {
  it("is open when flagged open and there is no deadline", () => {
    expect(isVotingOpenEffective(voting(), NOW)).toBe(true);
  });

  it("is open when the deadline is still in the future", () => {
    expect(
      isVotingOpenEffective(
        voting({ voting_deadline: "2099-01-01T00:00:00Z" }),
        NOW,
      ),
    ).toBe(true);
  });

  it("is closed when the deadline has passed", () => {
    expect(
      isVotingOpenEffective(
        voting({ voting_deadline: "2020-01-01T00:00:00Z" }),
        NOW,
      ),
    ).toBe(false);
  });

  it("is closed when is_open is false, regardless of deadline", () => {
    expect(
      isVotingOpenEffective(
        voting({ is_open: false, voting_deadline: "2099-01-01T00:00:00Z" }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isVotingOpenEffective(voting({ is_open: false }), NOW),
    ).toBe(false);
  });
});

// ── canViewResults ──────────────────────────────────────

describe("canViewResults", () => {
  it("is true when the voting is closed, even without voting", () => {
    const closed = voting({ is_open: false });
    expect(canViewResults(closed, false, false, NOW)).toBe(true);
  });

  it("is true when the voting deadline has passed, even without voting", () => {
    const expired = voting({ voting_deadline: "2020-01-01T00:00:00Z" });
    expect(canViewResults(expired, false, false, NOW)).toBe(true);
  });

  it("is false for an open voting when the member has not voted and is not management", () => {
    expect(canViewResults(voting(), false, false, NOW)).toBe(false);
  });

  it("is true for an open voting once the member has voted", () => {
    expect(canViewResults(voting(), true, false, NOW)).toBe(true);
  });

  it("is true for management even before voting", () => {
    expect(canViewResults(voting(), false, true, NOW)).toBe(true);
  });

  it("is true for management after voting", () => {
    expect(canViewResults(voting(), true, true, NOW)).toBe(true);
  });
});

// ── computeResults ──────────────────────────────────────

describe("computeResults", () => {
  const options = [
    { id: "opt-1", option_text: "Casa de la Cultura" },
    { id: "opt-2", option_text: "Centro Cívico" },
    { id: "opt-3", option_text: "Plaza Mayor" },
  ];

  it("counts votes per option and computes one-decimal percentages summing ~100", () => {
    const votes = [
      { option_id: "opt-1" },
      { option_id: "opt-1" },
      { option_id: "opt-1" },
      { option_id: "opt-1" },
      { option_id: "opt-2" },
      { option_id: "opt-2" },
      { option_id: "opt-2" },
      { option_id: "opt-3" },
    ];

    const results = computeResults(options, votes);

    expect(results).toHaveLength(3);
    expect(results[0]).toEqual({
      optionId: "opt-1",
      optionText: "Casa de la Cultura",
      votes: 4,
      totalVotes: 8,
      percentage: 50,
    });
    expect(results[1]?.percentage).toBe(37.5);
    expect(results[2]).toEqual({
      optionId: "opt-3",
      optionText: "Plaza Mayor",
      votes: 1,
      totalVotes: 8,
      percentage: 12.5,
    });

    const sum = results.reduce((acc, r) => acc + r.percentage, 0);
    expect(sum).toBe(100);
  });

  it("returns zeroes for every option when there are no votes", () => {
    const results = computeResults(options, []);

    expect(results).toHaveLength(3);
    for (const row of results) {
      expect(row.votes).toBe(0);
      expect(row.totalVotes).toBe(0);
      expect(row.percentage).toBe(0);
    }
  });

  it("handles ties with a 50/50 split", () => {
    const votes = [
      { option_id: "opt-1" },
      { option_id: "opt-1" },
      { option_id: "opt-2" },
      { option_id: "opt-2" },
    ];

    const results = computeResults(options, votes);

    expect(results[0]?.votes).toBe(2);
    expect(results[0]?.percentage).toBe(50);
    expect(results[1]?.votes).toBe(2);
    expect(results[1]?.percentage).toBe(50);
    expect(results[2]?.votes).toBe(0);
    expect(results[2]?.percentage).toBe(0);
  });

  it("reports counts only for votes on known options and ignores unknown option ids", () => {
    const votes = [
      { option_id: "opt-1" },
      { option_id: "opt-unknown" },
      { option_id: "opt-2" },
    ];

    const results = computeResults(options, votes);

    expect(results[0]?.votes).toBe(1);
    expect(results[1]?.votes).toBe(1);
    expect(results[2]?.votes).toBe(0);
    expect(results[0]?.totalVotes).toBe(3);
  });
});