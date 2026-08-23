import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  getAllMembers,
  getWorkgroupMembers,
  getComponentMembers,
  getMemberDetail,
  getMemberDetailWithHistory,
} from "@/lib/members/queries";
import { AuthorizationError } from "@/lib/auth/permissions";
import type { MemberActor } from "@/lib/members/authorization";
import type { ComponentType, Workgroup } from "@/types/database.types";

// ── Mocks ──────────────────────────────────────────────

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/shifts/assignments", () => ({
  getMyAssignedShifts: vi.fn(),
}));

vi.mock("@/lib/attendance/queries", () => ({
  getUserAttendance: vi.fn(),
}));

vi.mock("@/lib/rehearsals/queries", () => ({
  getUserRehearsalAttendance: vi.fn(),
}));

import { getMyAssignedShifts } from "@/lib/shifts/assignments";
import { getUserAttendance } from "@/lib/attendance/queries";
import { getUserRehearsalAttendance } from "@/lib/rehearsals/queries";

// ── Chain-builder stub (mirrors the news queries test pattern) ──

interface QueryResult {
  data: unknown[] | null;
  error?: Error | null;
}

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

function setupProfilesMock(result: QueryResult) {
  const builder = makeTableMock(result);
  mockFrom.mockImplementation((table: string) => {
    if (table !== "profiles") {
      throw new Error(`Unexpected table in test mock: ${table}`);
    }
    return builder;
  });
  return builder;
}

// ── Sample data ───────────────────────────────────────

const sampleRows = [
  {
    id: "user-1",
    first_name: "Ana",
    last_name: "López",
    component_type: "music",
    workgroup: "telas",
    role: "member",
    is_active: true,
    status: "active",
    username: null,
    auth_method: "google",
    component_lead_for: "music",
    created_at: "2026-01-10T10:00:00Z",
  },
  {
    id: "user-2",
    first_name: "Luis",
    last_name: "García",
    component_type: "member",
    workgroup: null,
    role: "rol-inventado", // invalid role → DEFAULT_ROLE
    is_active: true,
    status: "pending",
    username: "luis.g",
    auth_method: "email_alias",
    component_lead_for: null,
    created_at: "2026-02-01T09:00:00Z",
  },
];

const telasLead: MemberActor = {
  role: "member",
  isWorkgroupLead: true,
  workgroup: "telas",
  componentLeadFor: null,
};
const musicLead: MemberActor = {
  role: "member",
  isWorkgroupLead: false,
  workgroup: "ninguno",
  componentLeadFor: "music",
};

const sampleShifts = [
  {
    shiftId: "shift-1",
    shiftName: "Montaje escenario",
    eventId: "event-1",
    eventTitle: "Ensayo general",
    eventDate: "2026-03-01T10:00:00Z",
    startTime: "2026-03-01T10:00:00Z",
    endTime: "2026-03-01T14:00:00Z",
    assignedAt: "2026-02-20T10:00:00Z",
  },
];

const sampleAttendance = [
  {
    id: "att-1",
    eventId: "event-1",
    eventTitle: "Ensayo general",
    eventDate: "2026-03-01T10:00:00Z",
    attended: true,
    createdAt: "2026-03-01T12:00:00Z",
  },
];

// ── Tests ─────────────────────────────────────────────

describe("getAllMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("selects all profiles with no workgroup filter", async () => {
    const builder = setupProfilesMock({ data: sampleRows });

    const members = await getAllMembers();

    expect(builder.select).toHaveBeenCalledTimes(1);
    expect(builder.eq).not.toHaveBeenCalled();
    expect(members).toHaveLength(2);
    expect(members[0]!.id).toBe("user-1");
    expect(members[0]!.firstName).toBe("Ana");
    expect(members[0]!.workgroup).toBe("telas");
  });

  it("maps a null workgroup to ninguno", async () => {
    setupProfilesMock({ data: [sampleRows[1]] });

    const members = await getAllMembers();

    expect(members[0]!.workgroup).toBe("ninguno");
  });

  it("maps an invalid role to DEFAULT_ROLE", async () => {
    setupProfilesMock({ data: [sampleRows[1]] });

    const members = await getAllMembers();

    expect(members[0]!.role).toBe("member");
  });

  it("returns an empty array when there are no rows", async () => {
    setupProfilesMock({ data: [] });

    const members = await getAllMembers();

    expect(members).toEqual([]);
  });

  it("throws when the query fails", async () => {
    setupProfilesMock({ data: [], error: new Error("DB error") });

    await expect(getAllMembers()).rejects.toThrow("Failed to list members");
  });
});

describe("getWorkgroupMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws AuthorizationError when the actor is not the lead of the requested group", async () => {
    setupProfilesMock({ data: sampleRows });

    await expect(getWorkgroupMembers(telasLead, "barra")).rejects.toThrow(AuthorizationError);
    // Defense in depth: no DB query may run when the actor is not the lead.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("throws AuthorizationError for a plain member even when requesting their own group", async () => {
    setupProfilesMock({ data: sampleRows });
    const member: MemberActor = {
      role: "member",
      isWorkgroupLead: false,
      workgroup: "telas",
      componentLeadFor: null,
    };

    await expect(getWorkgroupMembers(member, "telas")).rejects.toThrow(AuthorizationError);
  });

  it("queries with .eq('workgroup', actor.workgroup) when the actor is the lead", async () => {
    const builder = setupProfilesMock({ data: sampleRows });

    const members = await getWorkgroupMembers(telasLead, "telas");

    expect(builder.eq).toHaveBeenCalledWith("workgroup", "telas" satisfies Workgroup);
    expect(members).toHaveLength(2);
  });

  it("maps results with the same mapping rules as getAllMembers", async () => {
    setupProfilesMock({ data: sampleRows });

    const members = await getWorkgroupMembers(telasLead, "telas");

    expect(members[0]!.workgroup).toBe("telas");
    expect(members[1]!.workgroup).toBe("ninguno");
    expect(members[1]!.role).toBe("member");
  });

  it("throws when the query fails", async () => {
    setupProfilesMock({ data: [], error: new Error("DB error") });

    await expect(getWorkgroupMembers(telasLead, "telas")).rejects.toThrow(
      "Failed to list members of workgroup telas",
    );
  });
});

describe("getComponentMembers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws AuthorizationError when the actor is not the lead of the requested component", async () => {
    setupProfilesMock({ data: sampleRows });
    const danceLead: MemberActor = {
      role: "member",
      isWorkgroupLead: false,
      workgroup: "ninguno",
      componentLeadFor: "dance",
    };

    await expect(getComponentMembers(musicLead, "dance" as ComponentType)).rejects.toThrow(
      AuthorizationError,
    );
    await expect(getComponentMembers(danceLead, "music" as ComponentType)).rejects.toThrow(
      AuthorizationError,
    );
    // Defense in depth: no DB query may run when the actor is not the lead.
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("throws AuthorizationError for a plain member even when requesting a matching component", async () => {
    setupProfilesMock({ data: sampleRows });
    const member: MemberActor = {
      role: "member",
      isWorkgroupLead: false,
      workgroup: "ninguno",
      componentLeadFor: null,
    };

    await expect(getComponentMembers(member, "music" as ComponentType)).rejects.toThrow(
      AuthorizationError,
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("queries with .eq('component_type', actor's component) when the actor is the lead", async () => {
    const builder = setupProfilesMock({ data: sampleRows });

    const members = await getComponentMembers(musicLead, "music");

    expect(builder.eq).toHaveBeenCalledWith("component_type", "music" satisfies ComponentType);
    expect(members).toHaveLength(2);
  });

  it("maps results including componentLeadFor", async () => {
    setupProfilesMock({ data: sampleRows });

    const members = await getComponentMembers(musicLead, "music");

    expect(members[0]!.componentLeadFor).toBe("music");
    expect(members[1]!.componentLeadFor).toBeNull();
  });

  it("throws when the query fails", async () => {
    setupProfilesMock({ data: [], error: new Error("DB error") });

    await expect(getComponentMembers(musicLead, "music")).rejects.toThrow(
      "Failed to list members of component music",
    );
  });
});

describe("getMemberDetail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the profile does not exist", async () => {
    setupProfilesMock({ data: [] });

    const detail = await getMemberDetail("missing");

    expect(detail).toBeNull();
  });

  it("returns the mapped profile including birthDate", async () => {
    setupProfilesMock({
      data: [{ ...sampleRows[0], birth_date: "1990-05-20" }],
    });

    const detail = await getMemberDetail("user-1");

    expect(detail).not.toBeNull();
    expect(detail?.firstName).toBe("Ana");
    expect(detail?.birthDate).toBe("1990-05-20");
    expect(detail?.workgroup).toBe("telas");
    expect(detail?.componentLeadFor).toBe("music");
  });

  it("throws when the query fails", async () => {
    setupProfilesMock({ data: [], error: new Error("DB error") });

    await expect(getMemberDetail("user-1")).rejects.toThrow("Failed to fetch member user-1");
  });
});

describe("getMemberDetailWithHistory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getMyAssignedShifts).mockResolvedValue(sampleShifts);
    vi.mocked(getUserAttendance).mockResolvedValue(sampleAttendance);
    vi.mocked(getUserRehearsalAttendance).mockResolvedValue([]);
  });

  it("returns null without querying history when the member does not exist", async () => {
    setupProfilesMock({ data: [] });

    const result = await getMemberDetailWithHistory("missing");

    expect(result).toBeNull();
    expect(getMyAssignedShifts).not.toHaveBeenCalled();
    expect(getUserAttendance).not.toHaveBeenCalled();
    expect(getUserRehearsalAttendance).not.toHaveBeenCalled();
  });

  it("returns member, assigned shifts and attendance history", async () => {
    setupProfilesMock({ data: [{ ...sampleRows[0], birth_date: null }] });

    const result = await getMemberDetailWithHistory("user-1");

    expect(result).not.toBeNull();
    expect(result?.member.id).toBe("user-1");
    expect(getMyAssignedShifts).toHaveBeenCalledWith("user-1");
    expect(getUserAttendance).toHaveBeenCalledWith("user-1");
    expect(getUserRehearsalAttendance).toHaveBeenCalledWith("user-1");
    expect(result!.shifts).toEqual(sampleShifts);
    expect(result!.attendance).toEqual(sampleAttendance);
    expect(result!.rehearsalAttendance).toEqual([]);
  });
});
