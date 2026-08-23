import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase client (workgroups-mutations test pattern)
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import {
  searchShiftMembers,
  escapeIlikePattern,
  type ShiftMemberSearchRow,
} from "@/lib/shifts/search";
import { AuthorizationError } from "@/lib/auth/permissions";
import type { AuthenticatedProfile } from "@/types/auth";

const SHIFT_ID = "123e4567-e89b-12d3-a456-426614174000";
const U1 = "223e4567-e89b-12d3-a456-426614174000";
const U2 = "323e4567-e89b-12d3-a456-426614174000";
const U3 = "423e4567-e89b-12d3-a456-426614174000";

const mockFrom = vi.fn();

interface QueryResult {
  data: unknown[] | null;
  error?: Error | null;
  count?: number | null;
}

function makeTableMock(result: QueryResult) {
  const thenableResult = Promise.resolve({
    data: result.data,
    error: result.error ?? null,
    count: result.count ?? null,
  });

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    then: thenableResult.then.bind(thenableResult),
    catch: thenableResult.catch.bind(thenableResult),
    finally: thenableResult.finally.bind(thenableResult),
  };

  return builder;
}

type TableBuilder = ReturnType<typeof makeTableMock>;

interface TableBuilders {
  shift_assignments: TableBuilder;
  profiles: TableBuilder;
  workgroup_attendance: TableBuilder;
}

function setupTables(tables: {
  shift_assignments?: QueryResult;
  profiles?: QueryResult;
  workgroup_attendance?: QueryResult;
}): TableBuilders {
  const builders: TableBuilders = {
    shift_assignments: makeTableMock(tables.shift_assignments ?? { data: [] }),
    profiles: makeTableMock(tables.profiles ?? { data: [] }),
    workgroup_attendance: makeTableMock(tables.workgroup_attendance ?? { data: [] }),
  };

  const byTable: Record<string, TableBuilder> = {
    shift_assignments: builders.shift_assignments,
    profiles: builders.profiles,
    workgroup_attendance: builders.workgroup_attendance,
  };
  mockFrom.mockImplementation(
    (table: string) => byTable[table] ?? makeTableMock({ data: [] }),
  );

  return builders;
}

function makeActor(overrides: Partial<AuthenticatedProfile>): AuthenticatedProfile {
  return {
    id: "actor-id",
    role: "member",
    isWorkgroupLead: false,
    workgroup: "ninguno",
    ...overrides,
  } as AuthenticatedProfile;
}

const managementActor = makeActor({ role: "super_admin" });
const leadActor = makeActor({ role: "member", isWorkgroupLead: true, workgroup: "telas" });
const plainActor = makeActor({ role: "member" });

function searchInput(overrides: Record<string, unknown> = {}) {
  return { shiftId: SHIFT_ID, query: "ana", ...overrides };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue({
    from: mockFrom,
  } as unknown as ReturnType<typeof createClient>);
});

describe("searchShiftMembers — authorization", () => {
  it("throws AuthorizationError for a role without permissions without touching the DB", async () => {
    await expect(searchShiftMembers(plainActor, searchInput())).rejects.toThrow(
      AuthorizationError,
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("searchShiftMembers — empty query short-circuit", () => {
  it("returns an empty page without executing any query when the query is blank", async () => {
    const page = await searchShiftMembers(managementActor, searchInput({ query: "   " }));

    expect(page).toEqual({ rows: [], total: 0, page: 1, pageSize: 20, hasMore: false });
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("searchShiftMembers — happy path", () => {
  it("runs three queries (assignments → profiles → attendance) and merges attendance", async () => {
    const builders = setupTables({
      shift_assignments: { data: [{ user_id: U1 }, { user_id: U2 }, { user_id: U3 }] },
      profiles: {
        data: [
          { id: U1, first_name: "Ana", last_name: "García", workgroup: "telas" },
          { id: U2, first_name: "Bruno", last_name: "López", workgroup: "barra" },
          { id: U3, first_name: "Carla", last_name: "Pérez", workgroup: "telas" },
        ],
        count: 3,
      },
      workgroup_attendance: {
        data: [
          { user_id: U1, attended: true },
          { user_id: U2, attended: false },
        ],
      },
    });

    const page = await searchShiftMembers(managementActor, searchInput());

    // Three tables queried, in order
    expect(mockFrom).toHaveBeenNthCalledWith(1, "shift_assignments");
    expect(mockFrom).toHaveBeenNthCalledWith(2, "profiles");
    expect(mockFrom).toHaveBeenNthCalledWith(3, "workgroup_attendance");

    // Query 1 anchors on the shift id via the existing index
    expect(builders.shift_assignments.eq).toHaveBeenCalledWith("shift_id", SHIFT_ID);

    // Query 2 filters by assigned ids + ilike or-filter, ordered and paginated
    expect(builders.profiles.in).toHaveBeenCalledWith("id", [U1, U2, U3]);
    const expectedPattern = escapeIlikePattern("ana");
    expect(builders.profiles.or).toHaveBeenCalledWith(
      `first_name.ilike.%${expectedPattern}%,last_name.ilike.%${expectedPattern}%`,
    );
    expect(builders.profiles.order).toHaveBeenNthCalledWith(1, "first_name", {
      ascending: true,
    });
    expect(builders.profiles.order).toHaveBeenNthCalledWith(2, "last_name", {
      ascending: true,
    });
    expect(builders.profiles.select).toHaveBeenCalledWith(
      "id, first_name, last_name, workgroup",
      { count: "exact" },
    );
    expect(builders.profiles.range).toHaveBeenCalledWith(0, 19);

    // Query 3 anchors on the shift id
    expect(builders.workgroup_attendance.eq).toHaveBeenCalledWith("shift_id", SHIFT_ID);

    const expectedRows: ShiftMemberSearchRow[] = [
      { userId: U1, firstName: "Ana", lastName: "García", workgroup: "telas", attended: true },
      { userId: U2, firstName: "Bruno", lastName: "López", workgroup: "barra", attended: false },
      { userId: U3, firstName: "Carla", lastName: "Pérez", workgroup: "telas", attended: null },
    ];
    expect(page.rows).toEqual(expectedRows);
    expect(page.total).toBe(3);
    expect(page.page).toBe(1);
    expect(page.pageSize).toBe(20);
    expect(page.hasMore).toBe(false);
  });

  it("escapes ILIKE wildcards in the search term before building the or-filter", async () => {
    const builders = setupTables({
      shift_assignments: { data: [{ user_id: U1 }] },
      profiles: { data: [{ id: U1, first_name: "Ana", last_name: "García", workgroup: "telas" }] },
      workgroup_attendance: { data: [] },
    });

    await searchShiftMembers(managementActor, searchInput({ query: 'a_50%\\b' }));

    const expectedPattern = escapeIlikePattern('a_50%\\b');
    expect(builders.profiles.or).toHaveBeenCalledWith(
      `first_name.ilike.%${expectedPattern}%,last_name.ilike.%${expectedPattern}%`,
    );
  });

  it("paginates with range(from, to) derived from page and pageSize", async () => {
    const builders = setupTables({
      shift_assignments: { data: [{ user_id: U1 }] },
      profiles: { data: [{ id: U1, first_name: "Ana", last_name: "García", workgroup: "telas" }] },
      workgroup_attendance: { data: [] },
    });

    const page = await searchShiftMembers(
      managementActor,
      searchInput({ page: 3, pageSize: 5 }),
    );

    expect(builders.profiles.range).toHaveBeenCalledWith(10, 14);
    expect(page.page).toBe(3);
    expect(page.pageSize).toBe(5);
  });

  it("sets hasMore=true when more pages remain according to total", async () => {
    const rows = Array.from({ length: 20 }, (_, i) => ({
      id: `u-${i}`,
      first_name: `Miembro${i}`,
      last_name: "Test",
      workgroup: "telas",
    }));
    setupTables({
      shift_assignments: { data: rows.map((r) => ({ user_id: r.id })) },
      profiles: { data: rows, count: 21 },
      workgroup_attendance: { data: [] },
    });

    const page = await searchShiftMembers(managementActor, searchInput({ pageSize: 20 }));

    expect(page.rows).toHaveLength(20);
    expect(page.total).toBe(21);
    expect(page.hasMore).toBe(true);
  });
});

describe("searchShiftMembers — workgroup scoping", () => {
  it("forces the lead's own workgroup even when another filter is requested", async () => {
    const builders = setupTables({
      shift_assignments: { data: [{ user_id: U1 }] },
      profiles: { data: [{ id: U1, first_name: "Ana", last_name: "García", workgroup: "telas" }] },
      workgroup_attendance: { data: [] },
    });

    await searchShiftMembers(leadActor, searchInput({ workgroup: "barra" }));

    const eqCalls = builders.profiles.eq.mock.calls;
    expect(eqCalls).toContainEqual(["workgroup", "telas"]);
    expect(eqCalls).not.toContainEqual(["workgroup", "barra"]);
  });

  it("applies the requested workgroup filter for management roles", async () => {
    const builders = setupTables({
      shift_assignments: { data: [{ user_id: U1 }] },
      profiles: {
        data: [{ id: U1, first_name: "Ana", last_name: "García", workgroup: "limpieza" }],
      },
      workgroup_attendance: { data: [] },
    });

    await searchShiftMembers(managementActor, searchInput({ workgroup: "limpieza" }));

    expect(builders.profiles.eq).toHaveBeenCalledWith("workgroup", "limpieza");
  });

  it("does not filter by workgroup for management roles when no filter is given", async () => {
    const builders = setupTables({
      shift_assignments: { data: [{ user_id: U1 }] },
      profiles: { data: [{ id: U1, first_name: "Ana", last_name: "García", workgroup: "telas" }] },
      workgroup_attendance: { data: [] },
    });

    await searchShiftMembers(managementActor, searchInput());

    const workgroupFilters = builders.profiles.eq.mock.calls.filter(
      ([column]) => column === "workgroup",
    );
    expect(workgroupFilters).toHaveLength(0);
  });
});

describe("searchShiftMembers — degenerate cases", () => {
  it("returns an empty page without querying profiles/attendance when the shift has no assignees", async () => {
    const builders = setupTables({
      shift_assignments: { data: [] },
    });

    const page = await searchShiftMembers(managementActor, searchInput());

    expect(page).toEqual({ rows: [], total: 0, page: 1, pageSize: 20, hasMore: false });
    expect(mockFrom).toHaveBeenCalledTimes(1);
    expect(builders.profiles.select).not.toHaveBeenCalled();
    expect(builders.workgroup_attendance.select).not.toHaveBeenCalled();
  });

  it("propagates a DB error from the assignments query", async () => {
    setupTables({
      shift_assignments: { data: null, error: new Error("connection refused") },
    });

    await expect(searchShiftMembers(managementActor, searchInput())).rejects.toThrow(
      /Error al obtener asignaciones del turno/,
    );
  });

  it("propagates a DB error from the profiles query", async () => {
    setupTables({
      shift_assignments: { data: [{ user_id: U1 }] },
      profiles: { data: null, error: new Error("timeout") },
    });

    await expect(searchShiftMembers(managementActor, searchInput())).rejects.toThrow(
      /Error al buscar miembros del turno/,
    );
  });

  it("propagates a DB error from the attendance query", async () => {
    setupTables({
      shift_assignments: { data: [{ user_id: U1 }] },
      profiles: { data: [{ id: U1, first_name: "A", last_name: "B", workgroup: "telas" }] },
      workgroup_attendance: { data: null, error: new Error("boom") },
    });

    await expect(searchShiftMembers(managementActor, searchInput())).rejects.toThrow(
      /Error al obtener asistencia del turno/,
    );
  });
});
