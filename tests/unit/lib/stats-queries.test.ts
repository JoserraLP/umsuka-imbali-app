import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  getPersonalActivityMarks,
  getMyWorkgroupShiftAverage,
} from "@/lib/stats/queries";

// ── Mocks ──────────────────────────────────────────────

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}));

// ── Chain-builder stub (mirrors the workgroups stats-queries test pattern) ──

interface QueryResult {
  data: unknown[] | null;
  error?: Error | null;
}

type TableBuilder = ReturnType<typeof makeTableMock>;

function makeTableMock(result: QueryResult) {
  const thenableResult = Promise.resolve(result);

  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    maybeSingle: vi.fn(() =>
      Promise.resolve(
        Array.isArray(result.data) ? { data: result.data[0] ?? null, error: result.error ?? null } : result,
      ),
    ),
    single: vi.fn(() =>
      Promise.resolve(
        Array.isArray(result.data) ? { data: result.data[0] ?? null, error: result.error ?? null } : result,
      ),
    ),
    then: thenableResult.then.bind(thenableResult),
    catch: thenableResult.catch.bind(thenableResult),
    finally: thenableResult.finally.bind(thenableResult),
  };

  return builder;
}

/** Registers one builder per table; unknown tables resolve to empty data. */
function setupTables(routes: Record<string, QueryResult> = {}) {
  const builders = new Map<string, TableBuilder>();
  mockFrom.mockImplementation((table: string) => {
    let builder = builders.get(table);
    if (!builder) {
      builder = makeTableMock(routes[table] ?? { data: [] });
      builders.set(table, builder);
    }
    return builder;
  });
  return builders;
}

// ── Sample data ───────────────────────────────────────

const USER_ANA = "223e4567-e89b-12d3-a456-426614174001";
const EVENT_A = "623e4567-e89b-12d3-a456-426614174005";
const EVENT_B = "723e4567-e89b-12d3-a456-426614174006";
const SHIFT_MORNING = "423e4567-e89b-12d3-a456-426614174003";

// ── Tests: getPersonalActivityMarks ───────────────────

describe("getPersonalActivityMarks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockReset();
  });

  it("filters every attendance table by user_id", async () => {
    const builders = setupTables({
      attendance: { data: [] },
      rehearsal_attendance: { data: [] },
      workgroup_attendance: { data: [] },
    });

    await getPersonalActivityMarks(USER_ANA);

    expect(builders.get("attendance")!.eq).toHaveBeenCalledWith("user_id", USER_ANA);
    expect(builders.get("rehearsal_attendance")!.eq).toHaveBeenCalledWith("user_id", USER_ANA);
    expect(builders.get("workgroup_attendance")!.eq).toHaveBeenCalledWith("user_id", USER_ANA);
  });

  it("joins event dates and shift start times and builds the marks", async () => {
    const builders = setupTables({
      attendance: {
        data: [
          { event_id: EVENT_A, attended: true, created_at: "2026-05-01T10:00:00Z" },
          { event_id: null, attended: false, created_at: "2026-06-01T10:00:00Z" },
        ],
      },
      rehearsal_attendance: {
        data: [{ event_id: EVENT_B, attended: false }],
      },
      workgroup_attendance: {
        data: [{ shift_id: SHIFT_MORNING, attended: true }],
      },
      events: {
        data: [
          { id: EVENT_A, event_date: "2026-05-10T18:00:00Z" },
          { id: EVENT_B, event_date: "2026-07-02T10:00:00Z" },
        ],
      },
      shifts: {
        data: [{ id: SHIFT_MORNING, start_time: "2026-08-01T09:00:00Z" }],
      },
    });

    const { eventMarks, rehearsalMarks, shiftMarks } =
      await getPersonalActivityMarks(USER_ANA);

    expect(builders.get("events")!.in).toHaveBeenCalledWith("id", [EVENT_A, EVENT_B]);
    expect(builders.get("shifts")!.in).toHaveBeenCalledWith("id", [SHIFT_MORNING]);

    // Attendance falls back to created_at when the event row is missing.
    expect(eventMarks).toEqual([
      { date: "2026-05-10T18:00:00Z", attended: true },
      { date: "2026-06-01T10:00:00Z", attended: false },
    ]);
    expect(rehearsalMarks).toEqual([{ date: "2026-07-02T10:00:00Z", attended: false }]);
    expect(shiftMarks).toEqual([{ date: "2026-08-01T09:00:00Z", attended: true }]);
  });

  it("drops marks whose date cannot be resolved", async () => {
    setupTables({
      attendance: { data: [] },
      rehearsal_attendance: {
        // Event id present but no matching event row → empty date → dropped.
        data: [{ event_id: EVENT_B, attended: true }],
      },
      workgroup_attendance: {
        // Shift without a resolvable start_time → dropped.
        data: [{ shift_id: SHIFT_MORNING, attended: true }],
      },
      events: { data: [] },
      shifts: { data: [] },
    });

    const { eventMarks, rehearsalMarks, shiftMarks } =
      await getPersonalActivityMarks(USER_ANA);

    expect(eventMarks).toEqual([]);
    expect(rehearsalMarks).toEqual([]);
    expect(shiftMarks).toEqual([]);
  });

  it("skips the secondary lookups when there are no ids to resolve", async () => {
    const builders = setupTables({
      attendance: { data: [] },
      rehearsal_attendance: { data: [] },
      workgroup_attendance: { data: [] },
    });

    const marks = await getPersonalActivityMarks(USER_ANA);

    expect(builders.get("events")).toBeUndefined();
    expect(builders.get("shifts")).toBeUndefined();
    expect(marks).toEqual({ eventMarks: [], rehearsalMarks: [], shiftMarks: [] });
  });

  it("tolerates null data on every query", async () => {
    setupTables({
      attendance: { data: null },
      rehearsal_attendance: { data: null },
      workgroup_attendance: { data: null },
    });

    const marks = await getPersonalActivityMarks(USER_ANA);

    expect(marks).toEqual({ eventMarks: [], rehearsalMarks: [], shiftMarks: [] });
  });

  it("throws when the attendance query fails", async () => {
    setupTables({
      attendance: { data: [], error: new Error("DB down") },
      rehearsal_attendance: { data: [] },
      workgroup_attendance: { data: [] },
    });

    await expect(getPersonalActivityMarks(USER_ANA)).rejects.toThrow(
      "Failed to fetch attendance",
    );
  });

  it("throws when the rehearsal attendance query fails", async () => {
    setupTables({
      attendance: { data: [] },
      rehearsal_attendance: { data: [], error: new Error("DB down") },
      workgroup_attendance: { data: [] },
    });

    await expect(getPersonalActivityMarks(USER_ANA)).rejects.toThrow(
      "Failed to fetch rehearsal attendance",
    );
  });

  it("throws when the workgroup attendance query fails", async () => {
    setupTables({
      attendance: { data: [] },
      rehearsal_attendance: { data: [] },
      workgroup_attendance: { data: [], error: new Error("DB down") },
    });

    await expect(getPersonalActivityMarks(USER_ANA)).rejects.toThrow(
      "Failed to fetch workgroup attendance",
    );
  });

  it("throws when the events lookup fails", async () => {
    setupTables({
      attendance: {
        data: [{ event_id: EVENT_A, attended: true, created_at: "2026-05-01T10:00:00Z" }],
      },
      rehearsal_attendance: { data: [] },
      workgroup_attendance: { data: [] },
      events: { data: [], error: new Error("DB down") },
    });

    await expect(getPersonalActivityMarks(USER_ANA)).rejects.toThrow("Failed to fetch events");
  });

  it("throws when the shifts lookup fails", async () => {
    setupTables({
      attendance: { data: [] },
      rehearsal_attendance: { data: [] },
      workgroup_attendance: {
        data: [{ shift_id: SHIFT_MORNING, attended: true }],
      },
      shifts: { data: [], error: new Error("DB down") },
    });

    await expect(getPersonalActivityMarks(USER_ANA)).rejects.toThrow("Failed to fetch shifts");
  });
});

// ── Tests: getMyWorkgroupShiftAverage ─────────────────

describe("getMyWorkgroupShiftAverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRpc.mockReset();
  });

  it("calls the rpc once and coerces numeric strings", async () => {
    mockRpc.mockResolvedValue({ data: "72.4", error: null });

    const average = await getMyWorkgroupShiftAverage();

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledWith("my_workgroup_shift_average");
    expect(average).toBe(72.4);
  });

  it("passes numbers through unchanged", async () => {
    mockRpc.mockResolvedValue({ data: 100, error: null });

    expect(await getMyWorkgroupShiftAverage()).toBe(100);
  });

  it("returns null when the rpc returns no data", async () => {
    mockRpc.mockResolvedValue({ data: null, error: null });

    expect(await getMyWorkgroupShiftAverage()).toBeNull();
  });

  it("throws a descriptive error when the rpc fails", async () => {
    mockRpc.mockResolvedValue({ data: null, error: new Error("permission denied") });

    await expect(getMyWorkgroupShiftAverage()).rejects.toThrow(
      "Failed to fetch my workgroup shift average",
    );
  });
});
