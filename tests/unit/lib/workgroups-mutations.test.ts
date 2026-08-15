import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase client + session (approvals mutations test pattern)
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { markWorkgroupAttendance } from "@/lib/workgroups/mutations";
import { WORKGROUP_ATTENDANCE_UNAVAILABLE_MESSAGE } from "@/lib/events/policy";

const mockFrom = vi.fn();

interface QueryResult {
  data: unknown[] | null;
  error?: Error | null;
}

function makeTableMock(result: QueryResult) {
  const thenableResult = Promise.resolve(result);

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    upsert: vi.fn(() => Promise.resolve({ data: null, error: result.error ?? null })),
    maybeSingle: vi.fn(() =>
      Promise.resolve(
        Array.isArray(result.data)
          ? { data: result.data[0] ?? null, error: result.error ?? null }
          : result,
      ),
    ),
    single: vi.fn(() =>
      Promise.resolve(
        Array.isArray(result.data)
          ? { data: result.data[0] ?? null, error: result.error ?? null }
          : result,
      ),
    ),
    then: thenableResult.then.bind(thenableResult),
    catch: thenableResult.catch.bind(thenableResult),
    finally: thenableResult.finally.bind(thenableResult),
  };

  return builder;
}

type TableResult = Pick<QueryResult, "data">;

type TableBuilder = ReturnType<typeof makeTableMock>;

interface TableBuilders {
  events: TableBuilder;
  shifts: TableBuilder;
  workgroup_attendance: TableBuilder;
}

function setupTables(tables: { events?: TableResult; shifts?: TableResult }): TableBuilders {
  const builders: TableBuilders = {
    events: makeTableMock(tables.events ?? { data: null, error: null }),
    shifts: makeTableMock(tables.shifts ?? { data: null, error: null }),
    workgroup_attendance: makeTableMock({ data: null, error: null }),
  };

  const byTable: Record<string, TableBuilder> = {
    events: builders.events,
    shifts: builders.shifts,
    workgroup_attendance: builders.workgroup_attendance,
  };
  mockFrom.mockImplementation(
    (table: string) => byTable[table] ?? makeTableMock({ data: null, error: null }),
  );

  return builders;
}

const superAdmin = {
  id: "user-1",
  role: "super_admin",
} as unknown as Awaited<ReturnType<typeof requireAuthenticatedProfile>>;

function validInput() {
  return {
    shiftId: "123e4567-e89b-12d3-a456-426614174000",
    userId: "223e4567-e89b-12d3-a456-426614174000",
    workgroup: "telas" as const,
    attended: true,
    hoursWorked: 3,
    barraTask: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue({
    from: mockFrom,
  } as unknown as ReturnType<typeof createClient>);
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(superAdmin);
});

describe("markWorkgroupAttendance", () => {
  it("returns 'Turno no encontrado.' when the shift does not exist", async () => {
    setupTables({ shifts: { data: [] } });

    const result = await markWorkgroupAttendance(validInput());

    expect(result.success).toBe(false);
    expect(result.error).toBe("Turno no encontrado.");
  });

  it("rejects marking attendance for a shift of a meeting event", async () => {
    const builders = setupTables({
      shifts: { data: [{ event_id: "event-meeting" }] },
      events: { data: [{ event_type: "meeting" }] },
    });

    const result = await markWorkgroupAttendance(validInput());

    expect(result.success).toBe(false);
    expect(result.error).toBe(WORKGROUP_ATTENDANCE_UNAVAILABLE_MESSAGE);
    expect(builders["workgroup_attendance"].upsert).not.toHaveBeenCalled();
  });

  it("rejects marking attendance for a shift of a carnival event", async () => {
    setupTables({
      shifts: { data: [{ event_id: "event-carnival" }] },
      events: { data: [{ event_type: "carnival" }] },
    });

    const result = await markWorkgroupAttendance(validInput());

    expect(result.success).toBe(false);
    expect(result.error).toBe(WORKGROUP_ATTENDANCE_UNAVAILABLE_MESSAGE);
  });

  it("marks attendance for a shift of a general event", async () => {
    setupTables({
      shifts: { data: [{ event_id: "event-general" }] },
      events: { data: [{ event_type: "general" }] },
    });

    const result = await markWorkgroupAttendance(validInput());

    expect(result.success).toBe(true);
  });
});
