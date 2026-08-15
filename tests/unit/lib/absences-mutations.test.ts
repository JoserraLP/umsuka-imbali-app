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
import { requestAbsence, justifyAbsence, deleteAbsence } from "@/lib/absences/mutations";
import { ABSENCES_UNAVAILABLE_MESSAGE } from "@/lib/events/policy";

const mockFrom = vi.fn();

const EVENT_ID = "123e4567-e89b-12d3-a456-426614174000";
const ABSENCE_ID = "223e4567-e89b-12d3-a456-426614174000";

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
  absences: TableBuilder;
}

function setupTables(tables: { events?: TableResult; absences?: TableResult }): TableBuilders {
  const builders: TableBuilders = {
    events: makeTableMock(tables.events ?? { data: null, error: null }),
    absences: makeTableMock(tables.absences ?? { data: null, error: null }),
  };

  const byTable: Record<string, TableBuilder> = {
    events: builders.events,
    absences: builders.absences,
  };
  mockFrom.mockImplementation(
    (table: string) => byTable[table] ?? makeTableMock({ data: null, error: null }),
  );

  return builders;
}

const admin = {
  id: "user-1",
  role: "admin",
} as unknown as Awaited<ReturnType<typeof requireAuthenticatedProfile>>;

function setupAdmin() {
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(admin);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue({
    from: mockFrom,
  } as unknown as ReturnType<typeof createClient>);
  setupAdmin();
});

describe("requestAbsence", () => {
  it("rejects requesting an absence for a meeting event", async () => {
    const builders = setupTables({ events: { data: [{ event_type: "meeting" }] } });

    const result = await requestAbsence({ eventId: EVENT_ID, reason: "Cita médica" });

    expect(result.success).toBe(false);
    expect(result.error).toBe(ABSENCES_UNAVAILABLE_MESSAGE);
    expect(builders.absences.insert).not.toHaveBeenCalled();
  });

  it("rejects requesting an absence for a carnival event", async () => {
    setupTables({ events: { data: [{ event_type: "carnival" }] } });

    const result = await requestAbsence({ eventId: EVENT_ID, reason: "Cita médica" });

    expect(result.success).toBe(false);
    expect(result.error).toBe(ABSENCES_UNAVAILABLE_MESSAGE);
  });

  it("allows requesting an absence for a general event", async () => {
    const builders = setupTables({ events: { data: [{ event_type: "general" }] } });

    const result = await requestAbsence({ eventId: EVENT_ID, reason: "Cita médica" });

    expect(result.success).toBe(true);
    expect(builders.absences.insert).toHaveBeenCalledTimes(1);
  });
});

describe("justifyAbsence", () => {
  it("returns 'Ausencia no encontrada.' when the absence does not exist", async () => {
    setupTables({ absences: { data: [] } });

    const result = await justifyAbsence({ absenceId: ABSENCE_ID, justified: true });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Ausencia no encontrada.");
  });

  it("rejects justifying an absence of a meeting event", async () => {
    const builders = setupTables({
      absences: { data: [{ event_id: "event-meeting" }] },
      events: { data: [{ event_type: "meeting" }] },
    });

    const result = await justifyAbsence({ absenceId: ABSENCE_ID, justified: true });

    expect(result.success).toBe(false);
    expect(result.error).toBe(ABSENCES_UNAVAILABLE_MESSAGE);
    expect(builders.absences.update).not.toHaveBeenCalled();
  });

  it("rejects justifying an absence of a carnival event", async () => {
    setupTables({
      absences: { data: [{ event_id: "event-carnival" }] },
      events: { data: [{ event_type: "carnival" }] },
    });

    const result = await justifyAbsence({ absenceId: ABSENCE_ID, justified: true });

    expect(result.success).toBe(false);
    expect(result.error).toBe(ABSENCES_UNAVAILABLE_MESSAGE);
  });

  it("justifies an absence of a general event", async () => {
    const builders = setupTables({
      absences: { data: [{ event_id: "event-general" }] },
      events: { data: [{ event_type: "general" }] },
    });

    const result = await justifyAbsence({ absenceId: ABSENCE_ID, justified: true });

    expect(result.success).toBe(true);
    expect(builders.absences.update).toHaveBeenCalledTimes(1);
  });
});

describe("deleteAbsence", () => {
  it("returns 'Ausencia no encontrada.' when the absence does not exist", async () => {
    setupTables({ absences: { data: [] } });

    const result = await deleteAbsence({ absenceId: ABSENCE_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Ausencia no encontrada.");
  });

  it("rejects deleting an absence of a meeting event", async () => {
    const builders = setupTables({
      absences: { data: [{ event_id: "event-meeting" }] },
      events: { data: [{ event_type: "meeting" }] },
    });

    const result = await deleteAbsence({ absenceId: ABSENCE_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe(ABSENCES_UNAVAILABLE_MESSAGE);
    expect(builders.absences.delete).not.toHaveBeenCalled();
  });

  it("deletes an absence of a general event", async () => {
    const builders = setupTables({
      absences: { data: [{ event_id: "event-general" }] },
      events: { data: [{ event_type: "general" }] },
    });

    const result = await deleteAbsence({ absenceId: ABSENCE_ID });

    expect(result.success).toBe(true);
    expect(builders.absences.delete).toHaveBeenCalledTimes(1);
  });
});
