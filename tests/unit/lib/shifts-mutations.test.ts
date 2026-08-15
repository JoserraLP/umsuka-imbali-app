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
import { createShift, updateShift, deleteShift } from "@/lib/shifts/mutations";
import { SHIFTS_UNAVAILABLE_MESSAGE } from "@/lib/events/policy";

const mockFrom = vi.fn();

const EVENT_ID = "123e4567-e89b-12d3-a456-426614174000";
const SHIFT_ID = "223e4567-e89b-12d3-a456-426614174000";

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
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    insert: vi.fn(() => Promise.resolve({ data: null, error: result.error ?? null })),
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
}

function setupTables(tables: { events?: TableResult; shifts?: TableResult }): TableBuilders {
  const builders: TableBuilders = {
    events: makeTableMock(tables.events ?? { data: null, error: null }),
    shifts: makeTableMock(tables.shifts ?? { data: null, error: null }),
  };

  const byTable: Record<string, TableBuilder> = {
    events: builders.events,
    shifts: builders.shifts,
  };
  mockFrom.mockImplementation(
    (table: string) => byTable[table] ?? makeTableMock({ data: null, error: null }),
  );

  return builders;
}

const manager = {
  id: "user-1",
  role: "super_admin",
} as unknown as Awaited<ReturnType<typeof requireAuthenticatedProfile>>;

function validShiftFields() {
  return {
    name: "Montaje escenario",
    startTime: "2026-03-01T10:00:00Z",
    endTime: "2026-03-01T14:00:00Z",
    maxAssignees: null,
    workgroup: null,
    // The input schema rejects null for notes (string-only); an empty
    // string passes and is transformed to null by the schema.
    notes: "",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue({
    from: mockFrom,
  } as unknown as ReturnType<typeof createClient>);
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(manager);
});

describe("createShift", () => {
  it("rejects creating a shift for a meeting event", async () => {
    setupTables({ events: { data: [{ event_type: "meeting" }] } });

    const result = await createShift({ ...validShiftFields(), eventId: EVENT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe(SHIFTS_UNAVAILABLE_MESSAGE);
  });

  it("rejects creating a shift for a carnival event", async () => {
    setupTables({ events: { data: [{ event_type: "carnival" }] } });

    const result = await createShift({ ...validShiftFields(), eventId: EVENT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe(SHIFTS_UNAVAILABLE_MESSAGE);
  });

  it("allows creating a shift for a general event", async () => {
    const builders = setupTables({ events: { data: [{ event_type: "general" }] } });

    const result = await createShift({ ...validShiftFields(), eventId: EVENT_ID });

    expect(result.success).toBe(true);
    expect(builders.shifts.insert).toHaveBeenCalledTimes(1);
  });

  it("allows creating a shift for a work_shift event", async () => {
    const builders = setupTables({ events: { data: [{ event_type: "work_shift" }] } });

    const result = await createShift({ ...validShiftFields(), eventId: EVENT_ID });

    expect(result.success).toBe(true);
    expect(builders.shifts.insert).toHaveBeenCalledTimes(1);
  });

  it("keeps the management permission check intact", async () => {
    setupTables({ events: { data: [{ event_type: "general" }] } });
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue({
      id: "user-2",
      role: "member",
      isWorkgroupLead: false,
    } as unknown as Awaited<ReturnType<typeof requireAuthenticatedProfile>>);

    const result = await createShift({ ...validShiftFields(), eventId: EVENT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe("No tienes permisos para gestionar turnos.");
  });
});

describe("updateShift", () => {
  it("rejects updating a shift whose real event is attendance-only, even when the input eventId is general", async () => {
    const builders = setupTables({
      // The source of truth is the shift's real event, not the input.
      shifts: { data: [{ event_id: "event-meeting" }] },
      events: { data: [{ event_type: "meeting" }] },
    });

    const result = await updateShift({
      ...validShiftFields(),
      id: SHIFT_ID,
      eventId: EVENT_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(SHIFTS_UNAVAILABLE_MESSAGE);
    expect(builders.shifts.update).not.toHaveBeenCalled();
  });

  it("returns 'Turno no encontrado.' when the shift does not exist", async () => {
    setupTables({ shifts: { data: [] } });

    const result = await updateShift({
      ...validShiftFields(),
      id: SHIFT_ID,
      eventId: EVENT_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Turno no encontrado.");
  });

  it("updates a shift whose real event is general", async () => {
    const builders = setupTables({
      shifts: { data: [{ event_id: "event-general" }] },
      events: { data: [{ event_type: "general" }] },
    });

    const result = await updateShift({
      ...validShiftFields(),
      id: SHIFT_ID,
      eventId: EVENT_ID,
    });

    expect(result.success).toBe(true);
    expect(builders.shifts.update).toHaveBeenCalledTimes(1);
  });
});

describe("deleteShift", () => {
  it("rejects deleting a shift of a meeting event", async () => {
    const builders = setupTables({
      shifts: { data: [{ event_id: "event-meeting" }] },
      events: { data: [{ event_type: "meeting" }] },
    });

    const result = await deleteShift({ id: SHIFT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe(SHIFTS_UNAVAILABLE_MESSAGE);
    expect(builders.shifts.delete).not.toHaveBeenCalled();
  });

  it("deletes a shift of a general event", async () => {
    const builders = setupTables({
      shifts: { data: [{ event_id: "event-general" }] },
      events: { data: [{ event_type: "general" }] },
    });

    const result = await deleteShift({ id: SHIFT_ID });

    expect(result.success).toBe(true);
    expect(builders.shifts.delete).toHaveBeenCalledTimes(1);
  });

  it("returns 'Turno no encontrado.' when the shift does not exist", async () => {
    setupTables({ shifts: { data: [] } });

    const result = await deleteShift({ id: SHIFT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Turno no encontrado.");
  });
});
