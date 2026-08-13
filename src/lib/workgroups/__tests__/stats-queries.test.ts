import { describe, expect, it, vi, beforeEach } from "vitest";
import { getGroupStats, getMemberStatsDetail } from "@/lib/workgroups/stats-queries";
import { AuthorizationError } from "@/lib/auth/permissions";
import type { StatsActor } from "@/lib/workgroups/stats";

// ── Mocks ──────────────────────────────────────────────

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/workgroups/queries", () => ({
  getAllWorkgroupMembers: vi.fn(),
}));

vi.mock("@/lib/members/queries", () => ({
  getMemberDetail: vi.fn(),
}));

import { getAllWorkgroupMembers } from "@/lib/workgroups/queries";
import { getMemberDetail } from "@/lib/members/queries";

// ── Chain-builder stub (mirrors the members queries test pattern) ──

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
const USER_LUIS = "323e4567-e89b-12d3-a456-426614174002";
const SHIFT_MORNING = "423e4567-e89b-12d3-a456-426614174003";
const SHIFT_NIGHT = "523e4567-e89b-12d3-a456-426614174004";
const EVENT_ENSAYO = "623e4567-e89b-12d3-a456-426614174005";

const telasLead: StatsActor = {
  role: "member",
  isWorkgroupLead: true,
  workgroup: "telas",
};

const superAdmin: StatsActor = {
  role: "super_admin",
  isWorkgroupLead: false,
  workgroup: "ninguno",
};

const plainMember: StatsActor = {
  role: "member",
  isWorkgroupLead: false,
  workgroup: "telas",
};

const plainAdmin: StatsActor = {
  role: "admin",
  isWorkgroupLead: false,
  workgroup: "telas",
};

const telasMembers = [
  { userId: USER_LUIS, firstName: "Luis", lastName: "García", workgroup: "telas" as const },
  { userId: USER_ANA, firstName: "Ana", lastName: "López", workgroup: "telas" as const },
];

// ── Tests: getGroupStats ──────────────────────────────

describe("getGroupStats", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws AuthorizationError for a lead of a different group without querying", async () => {
    setupTables();
    vi.mocked(getAllWorkgroupMembers).mockResolvedValue(telasMembers);

    await expect(getGroupStats(telasLead, "barra")).rejects.toThrow(AuthorizationError);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("throws AuthorizationError for a plain admin", async () => {
    setupTables();
    vi.mocked(getAllWorkgroupMembers).mockResolvedValue(telasMembers);

    await expect(getGroupStats(plainAdmin, "telas")).rejects.toThrow(AuthorizationError);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("throws AuthorizationError for a plain member", async () => {
    setupTables();
    vi.mocked(getAllWorkgroupMembers).mockResolvedValue(telasMembers);

    await expect(getGroupStats(plainMember, "telas")).rejects.toThrow(AuthorizationError);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("throws AuthorizationError for super_admin requesting ninguno", async () => {
    setupTables();

    await expect(getGroupStats(superAdmin, "ninguno")).rejects.toThrow(AuthorizationError);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("queries attendance, shifts and assignments and aggregates stats for the lead", async () => {
    const builders = setupTables({
      workgroup_attendance: {
        data: [
          { user_id: USER_ANA, shift_id: SHIFT_MORNING, attended: true, hours_worked: null },
          { user_id: USER_ANA, shift_id: SHIFT_NIGHT, attended: false, hours_worked: 2 },
        ],
      },
      shifts: {
        data: [
          { id: SHIFT_MORNING, start_time: "2026-03-01T10:00:00Z", end_time: "2026-03-01T14:00:00Z" },
          { id: SHIFT_NIGHT, start_time: "2026-03-01T20:00:00Z", end_time: "2026-03-01T23:00:00Z" },
        ],
      },
      shift_assignments: {
        data: [{ user_id: USER_ANA }, { user_id: USER_ANA }, { user_id: USER_LUIS }],
      },
    });
    vi.mocked(getAllWorkgroupMembers).mockResolvedValue(telasMembers);

    const stats = await getGroupStats(telasLead, "telas");

    expect(getAllWorkgroupMembers).toHaveBeenCalledWith("telas");
    expect(builders.get("workgroup_attendance")!.eq).toHaveBeenCalledWith("workgroup", "telas");
    expect(builders.get("shifts")!.in).toHaveBeenCalledWith("id", [SHIFT_MORNING, SHIFT_NIGHT]);
    expect(builders.get("shift_assignments")!.in).toHaveBeenCalledWith("user_id", [
      USER_LUIS,
      USER_ANA,
    ]);

    expect(stats.workgroup).toBe("telas");
    expect(stats.members).toHaveLength(2);
    const ana = stats.members[0]!;
    expect(ana.userId).toBe(USER_ANA);
    expect(ana.assignedShifts).toBe(2);
    expect(ana.markedShifts).toBe(2);
    expect(ana.attendedShifts).toBe(1);
    expect(ana.totalHours).toBe(4); // duration of SHIFT_MORNING; absent row counts 0
    expect(ana.attendanceRate).toBe(50);
    const luis = stats.members[1]!;
    expect(luis.assignedShifts).toBe(1);
    expect(luis.markedShifts).toBe(0);
    expect(luis.attendanceRate).toBeNull();
  });

  it("allows super_admin to view a group they do not lead", async () => {
    const builders = setupTables({
      workgroup_attendance: { data: [] },
      shift_assignments: { data: [] },
    });
    vi.mocked(getAllWorkgroupMembers).mockResolvedValue(telasMembers);

    const stats = await getGroupStats(superAdmin, "barra");

    expect(getAllWorkgroupMembers).toHaveBeenCalledWith("barra");
    expect(builders.get("workgroup_attendance")!.eq).toHaveBeenCalledWith("workgroup", "barra");
    expect(stats.workgroup).toBe("barra");
    expect(stats.members).toHaveLength(2);
  });

  it("skips the shifts query when there is no attendance", async () => {
    const builders = setupTables({
      workgroup_attendance: { data: [] },
      shift_assignments: { data: [] },
    });
    vi.mocked(getAllWorkgroupMembers).mockResolvedValue(telasMembers);

    const stats = await getGroupStats(telasLead, "telas");

    expect(builders.get("shifts")).toBeUndefined();
    expect(stats.members.every((m) => m.markedShifts === 0)).toBe(true);
  });

  it("throws when the attendance query fails", async () => {
    setupTables({
      workgroup_attendance: { data: [], error: new Error("DB down") },
    });
    vi.mocked(getAllWorkgroupMembers).mockResolvedValue(telasMembers);

    await expect(getGroupStats(telasLead, "telas")).rejects.toThrow(
      "Failed to fetch workgroup attendance",
    );
  });

  it("throws when the shifts query fails", async () => {
    setupTables({
      workgroup_attendance: {
        data: [{ user_id: USER_ANA, shift_id: SHIFT_MORNING, attended: true, hours_worked: null }],
      },
      shifts: { data: [], error: new Error("DB down") },
    });
    vi.mocked(getAllWorkgroupMembers).mockResolvedValue(telasMembers);

    await expect(getGroupStats(telasLead, "telas")).rejects.toThrow("Failed to fetch shifts");
  });

  it("throws when the assignments query fails", async () => {
    setupTables({
      workgroup_attendance: { data: [] },
      shift_assignments: { data: [], error: new Error("DB down") },
    });
    vi.mocked(getAllWorkgroupMembers).mockResolvedValue(telasMembers);

    await expect(getGroupStats(telasLead, "telas")).rejects.toThrow(
      "Failed to fetch shift assignments",
    );
  });

  it("throws when listing the members fails", async () => {
    setupTables();
    vi.mocked(getAllWorkgroupMembers).mockRejectedValue(new Error("members failed"));

    await expect(getGroupStats(telasLead, "telas")).rejects.toThrow("members failed");
  });
});

// ── Tests: getMemberStatsDetail ───────────────────────

describe("getMemberStatsDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const anaProfile = {
    id: USER_ANA,
    firstName: "Ana",
    lastName: "López",
    workgroup: "telas" as const,
    componentType: "member" as const,
    role: "member" as const,
    isActive: true,
    status: "active" as const,
    username: null,
    authMethod: "google" as const,
    componentLeadFor: null,
    birthDate: null,
    createdAt: "2026-01-10T10:00:00Z",
  };

  it("throws AuthorizationError when the actor cannot view the group", async () => {
    setupTables();
    vi.mocked(getMemberDetail).mockResolvedValue(anaProfile);

    await expect(getMemberStatsDetail(telasLead, "barra", USER_ANA)).rejects.toThrow(
      AuthorizationError,
    );
    expect(getMemberDetail).not.toHaveBeenCalled();
  });

  it("returns null when the profile does not exist", async () => {
    setupTables();
    vi.mocked(getMemberDetail).mockResolvedValue(null);

    const detail = await getMemberStatsDetail(telasLead, "telas", "missing-user");

    expect(detail).toBeNull();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("throws AuthorizationError when a lead requests a member outside the group", async () => {
    setupTables();
    vi.mocked(getMemberDetail).mockResolvedValue({ ...anaProfile, workgroup: "barra" });

    await expect(getMemberStatsDetail(telasLead, "telas", USER_ANA)).rejects.toThrow(
      AuthorizationError,
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("queries attendance, shifts, events and assignments for a lead of the group", async () => {
    const builders = setupTables({
      workgroup_attendance: {
        data: [
          {
            id: "att-1",
            shift_id: SHIFT_MORNING,
            attended: true,
            hours_worked: null,
            barra_task: null,
          },
          {
            id: "att-2",
            shift_id: SHIFT_NIGHT,
            attended: true,
            hours_worked: 1.5,
            barra_task: null,
          },
        ],
      },
      shifts: {
        data: [
          {
            id: SHIFT_MORNING,
            name: "Montaje",
            event_id: EVENT_ENSAYO,
            start_time: "2026-03-01T10:00:00Z",
            end_time: "2026-03-01T14:00:00Z",
          },
          {
            id: SHIFT_NIGHT,
            name: "Recogida",
            event_id: EVENT_ENSAYO,
            start_time: "2026-03-01T20:00:00Z",
            end_time: "2026-03-01T21:00:00Z",
          },
        ],
      },
      events: {
        data: [{ id: EVENT_ENSAYO, title: "Ensayo general", event_date: "2026-03-02T10:00:00Z" }],
      },
      shift_assignments: { data: [{ user_id: USER_ANA }, { user_id: USER_ANA }, { user_id: USER_ANA }] },
    });
    vi.mocked(getMemberDetail).mockResolvedValue(anaProfile);

    const detail = await getMemberStatsDetail(telasLead, "telas", USER_ANA);

    expect(getMemberDetail).toHaveBeenCalledWith(USER_ANA);
    const attendanceBuilder = builders.get("workgroup_attendance")!;
    expect(attendanceBuilder.eq).toHaveBeenCalledWith("user_id", USER_ANA);
    expect(attendanceBuilder.eq).toHaveBeenCalledWith("workgroup", "telas");
    expect(builders.get("shifts")!.in).toHaveBeenCalledWith("id", [SHIFT_MORNING, SHIFT_NIGHT]);
    expect(builders.get("events")!.in).toHaveBeenCalledWith("id", [EVENT_ENSAYO]);
    expect(builders.get("shift_assignments")!.eq).toHaveBeenCalledWith("user_id", USER_ANA);

    expect(detail).not.toBeNull();
    expect(detail!.userId).toBe(USER_ANA);
    expect(detail!.workgroup).toBe("telas");
    expect(detail!.assignedShifts).toBe(3);
    expect(detail!.markedShifts).toBe(2);
    expect(detail!.attendedShifts).toBe(2);
    expect(detail!.totalHours).toBe(5.5); // 4 (duration) + 1.5 (worked)
    expect(detail!.attendanceRate).toBe(100);
    // Night shift starts later → first
    expect(detail!.shifts.map((s) => s.shiftId)).toEqual([SHIFT_NIGHT, SHIFT_MORNING]);
    expect(detail!.shifts[0]!.eventTitle).toBe("Ensayo general");
    expect(detail!.shifts[0]!.eventDate).toBe("2026-03-02T10:00:00Z");
    expect(detail!.shifts[1]!.hours).toBe(4);
  });

  it("allows super_admin with a member of another group", async () => {
    const builders = setupTables({
      workgroup_attendance: { data: [] },
      shift_assignments: { data: [] },
    });
    vi.mocked(getMemberDetail).mockResolvedValue({ ...anaProfile, workgroup: "barra" });

    const detail = await getMemberStatsDetail(superAdmin, "barra", USER_ANA);

    expect(detail).not.toBeNull();
    expect(builders.get("workgroup_attendance")!.eq).toHaveBeenCalledWith("workgroup", "barra");
    expect(builders.get("shifts")).toBeUndefined();
  });

  it("skips shifts and events queries without attendance", async () => {
    const builders = setupTables({
      workgroup_attendance: { data: [] },
      shift_assignments: { data: [] },
    });
    vi.mocked(getMemberDetail).mockResolvedValue(anaProfile);

    const detail = await getMemberStatsDetail(telasLead, "telas", USER_ANA);

    expect(builders.get("shifts")).toBeUndefined();
    expect(builders.get("events")).toBeUndefined();
    expect(detail!.shifts).toEqual([]);
    expect(detail!.attendanceRate).toBeNull();
  });

  it("tolerates null event and assignment rows", async () => {
    setupTables({
      workgroup_attendance: {
        data: [
          { id: "att-1", shift_id: SHIFT_MORNING, attended: true, hours_worked: null, barra_task: null },
        ],
      },
      shifts: {
        data: [
          {
            id: SHIFT_MORNING,
            name: "Montaje",
            event_id: EVENT_ENSAYO,
            start_time: "2026-03-01T10:00:00Z",
            end_time: "2026-03-01T14:00:00Z",
          },
        ],
      },
      events: { data: null },
      shift_assignments: { data: null },
    });
    vi.mocked(getMemberDetail).mockResolvedValue(anaProfile);

    const detail = await getMemberStatsDetail(telasLead, "telas", USER_ANA);

    expect(detail).not.toBeNull();
    expect(detail!.assignedShifts).toBe(0);
    expect(detail!.shifts[0]!.eventTitle).toBe("Evento desconocido");
    expect(detail!.shifts[0]!.eventDate).toBeNull();
  });

  it("tolerates null shift rows", async () => {
    setupTables({
      workgroup_attendance: {
        data: [
          { id: "att-1", shift_id: SHIFT_MORNING, attended: true, hours_worked: null, barra_task: null },
        ],
      },
      shifts: { data: null },
      shift_assignments: { data: [] },
    });
    vi.mocked(getMemberDetail).mockResolvedValue(anaProfile);

    const detail = await getMemberStatsDetail(telasLead, "telas", USER_ANA);

    expect(detail).not.toBeNull();
    expect(detail!.shifts[0]!.shiftName).toBe("Turno sin nombre");
    expect(detail!.shifts[0]!.eventId).toBe("");
    expect(detail!.shifts[0]!.hours).toBe(0);
  });

  it("throws when the attendance query fails", async () => {
    setupTables({
      workgroup_attendance: { data: [], error: new Error("DB down") },
    });
    vi.mocked(getMemberDetail).mockResolvedValue(anaProfile);

    await expect(getMemberStatsDetail(telasLead, "telas", USER_ANA)).rejects.toThrow(
      "Failed to fetch workgroup attendance",
    );
  });

  it("throws when the shifts query fails", async () => {
    setupTables({
      workgroup_attendance: {
        data: [{ id: "att-1", shift_id: SHIFT_MORNING, attended: true, hours_worked: null, barra_task: null }],
      },
      shifts: { data: [], error: new Error("DB down") },
    });
    vi.mocked(getMemberDetail).mockResolvedValue(anaProfile);

    await expect(getMemberStatsDetail(telasLead, "telas", USER_ANA)).rejects.toThrow(
      "Failed to fetch shifts",
    );
  });

  it("throws when the events query fails", async () => {
    setupTables({
      workgroup_attendance: {
        data: [{ id: "att-1", shift_id: SHIFT_MORNING, attended: true, hours_worked: null, barra_task: null }],
      },
      shifts: {
        data: [
          {
            id: SHIFT_MORNING,
            name: "Montaje",
            event_id: EVENT_ENSAYO,
            start_time: "2026-03-01T10:00:00Z",
            end_time: "2026-03-01T14:00:00Z",
          },
        ],
      },
      events: { data: [], error: new Error("DB down") },
    });
    vi.mocked(getMemberDetail).mockResolvedValue(anaProfile);

    await expect(getMemberStatsDetail(telasLead, "telas", USER_ANA)).rejects.toThrow(
      "Failed to fetch events",
    );
  });

  it("throws when the assignments query fails", async () => {
    setupTables({
      workgroup_attendance: { data: [] },
      shift_assignments: { data: [], error: new Error("DB down") },
    });
    vi.mocked(getMemberDetail).mockResolvedValue(anaProfile);

    await expect(getMemberStatsDetail(telasLead, "telas", USER_ANA)).rejects.toThrow(
      "Failed to fetch shift assignments",
    );
  });
});