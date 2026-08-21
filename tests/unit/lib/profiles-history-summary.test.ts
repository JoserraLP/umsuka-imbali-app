import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by vitest) ──────────────────────────

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

import { getProfileHistorySummary } from "@/lib/profiles/queries";

const USER_ID = "323e4567-e89b-12d3-a456-426614174000";

// ── Chain-builder stub (head-only count queries) ──

interface CountResult {
  count?: number | null;
  error?: { message: string } | null;
}

function makeBuilder(result: CountResult = {}) {
  const thenable = Promise.resolve({
    data: null,
    count: result.count ?? null,
    error: result.error ?? null,
  });

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    then: thenable.then.bind(thenable),
    catch: thenable.catch.bind(thenable),
    finally: thenable.finally.bind(thenable),
  };
  return builder;
}

function setupScript(script: Array<{ table: string; result?: CountResult }>) {
  const builders: ReturnType<typeof makeBuilder>[] = [];
  let index = 0;
  mockFrom.mockImplementation((table: string) => {
    const step = script[index];
    if (!step || step.table !== table) {
      throw new Error(
        `Unexpected table "${table}" at call ${index} (expected "${step?.table ?? "none"}")`,
      );
    }
    index += 1;
    const builder = makeBuilder(step.result);
    builders.push(builder);
    return builder;
  });
  return builders;
}

const HEAD_ONLY_SELECT = ["*", { count: "exact", head: true }] as const;

// ── Tests ─────────────────────────────────────────────

describe("getProfileHistorySummary", () => {
  const script = [
    { table: "event_registrations", result: { count: 3 } },
    { table: "attendance", result: { count: 5 } },
    { table: "attendance", result: { count: 2 } },
    { table: "absences", result: { count: 1 } },
    { table: "shift_assignments", result: { count: 4 } },
    { table: "rehearsal_attendance", result: { count: 6 } },
    { table: "rehearsal_attendance", result: { count: 8 } },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs seven head-only count queries scoped to the user and returns the summary", async () => {
    const builders = setupScript(script);

    const summary = await getProfileHistorySummary(USER_ID);

    expect(summary).toEqual({
      events: 3,
      attendancePresent: 5,
      attendanceAbsent: 2,
      absences: 1,
      shifts: 4,
      rehearsalsAttended: 6,
      rehearsalsMarked: 8,
    });

    // Every query is head-only and scoped to the user.
    for (const builder of builders) {
      expect(builder.select).toHaveBeenCalledWith(...HEAD_ONLY_SELECT);
      expect(builder.eq).toHaveBeenCalledWith("user_id", USER_ID);
    }

    // The two attendance queries split present vs absent.
    expect(builders[1]!.eq).toHaveBeenCalledWith("attended", true);
    expect(builders[2]!.eq).toHaveBeenCalledWith("attended", false);

    // The two rehearsal queries split attended vs total marked.
    expect(builders[5]!.eq).toHaveBeenCalledWith("attended", true);
  });

  it("falls back to 0 when a count is null", async () => {
    setupScript([
      { table: "event_registrations", result: { count: null } },
      { table: "attendance", result: { count: null } },
      { table: "attendance", result: { count: null } },
      { table: "absences", result: { count: null } },
      { table: "shift_assignments", result: { count: null } },
      { table: "rehearsal_attendance", result: { count: null } },
      { table: "rehearsal_attendance", result: { count: null } },
    ]);

    const summary = await getProfileHistorySummary(USER_ID);

    expect(summary).toEqual({
      events: 0,
      attendancePresent: 0,
      attendanceAbsent: 0,
      absences: 0,
      shifts: 0,
      rehearsalsAttended: 0,
      rehearsalsMarked: 0,
    });
  });

  it("throws when any query fails, identifying the failing table", async () => {
    setupScript([
      { table: "event_registrations", result: { count: 3 } },
      { table: "attendance", result: { count: 5 } },
      { table: "attendance", result: { count: 2 } },
      { table: "absences", result: { error: { message: "select failed" } } },
      { table: "shift_assignments", result: { count: 4 } },
      { table: "rehearsal_attendance", result: { count: 6 } },
      { table: "rehearsal_attendance", result: { count: 8 } },
    ]);

    await expect(getProfileHistorySummary(USER_ID)).rejects.toThrow(
      "Failed to fetch absences count",
    );
  });
});
