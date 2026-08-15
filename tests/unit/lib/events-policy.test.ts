import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase client (chain-builder pattern from members queries test)
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import {
  isAttendanceOnlyEventType,
  rejectAttendanceOnlyEvent,
  SHIFTS_UNAVAILABLE_MESSAGE,
  ABSENCES_UNAVAILABLE_MESSAGE,
} from "@/lib/events/policy";

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue({
    from: mockFrom,
  } as unknown as ReturnType<typeof createClient>);
});

describe("isAttendanceOnlyEventType", () => {
  it.each(["meeting", "carnival"] as const)("returns true for %s", (eventType) => {
    expect(isAttendanceOnlyEventType(eventType)).toBe(true);
  });

  it.each(["general", "work_shift", "other", ""])("returns false for %s", (eventType) => {
    expect(isAttendanceOnlyEventType(eventType)).toBe(false);
  });

  it("returns false for null and undefined", () => {
    expect(isAttendanceOnlyEventType(null)).toBe(false);
    expect(isAttendanceOnlyEventType(undefined)).toBe(false);
  });
});

describe("rejectAttendanceOnlyEvent", () => {
  it("returns the shifts message when the event is a meeting", async () => {
    mockFrom.mockReturnValue(makeTableMock({ data: [{ event_type: "meeting" }] }));

    const err = await rejectAttendanceOnlyEvent("event-1", SHIFTS_UNAVAILABLE_MESSAGE);

    expect(err).toBe(SHIFTS_UNAVAILABLE_MESSAGE);
    expect(mockFrom).toHaveBeenCalledWith("events");
  });

  it("returns the absences message when the event is a carnival", async () => {
    mockFrom.mockReturnValue(makeTableMock({ data: [{ event_type: "carnival" }] }));

    const err = await rejectAttendanceOnlyEvent("event-1", ABSENCES_UNAVAILABLE_MESSAGE);

    expect(err).toBe(ABSENCES_UNAVAILABLE_MESSAGE);
  });

  it("returns null when the event exists and is not attendance-only", async () => {
    mockFrom.mockReturnValue(makeTableMock({ data: [{ event_type: "general" }] }));

    const err = await rejectAttendanceOnlyEvent("event-1", SHIFTS_UNAVAILABLE_MESSAGE);

    expect(err).toBeNull();
  });

  it("returns null for a work_shift event", async () => {
    mockFrom.mockReturnValue(makeTableMock({ data: [{ event_type: "work_shift" }] }));

    const err = await rejectAttendanceOnlyEvent("event-1", SHIFTS_UNAVAILABLE_MESSAGE);

    expect(err).toBeNull();
  });

  it("returns 'Evento no encontrado.' when the event does not exist", async () => {
    mockFrom.mockReturnValue(makeTableMock({ data: [] }));

    const err = await rejectAttendanceOnlyEvent("missing-event", SHIFTS_UNAVAILABLE_MESSAGE);

    expect(err).toBe("Evento no encontrado.");
  });
});
