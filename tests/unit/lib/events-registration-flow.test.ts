import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by vitest) ──────────────────────────

const mockFrom = vi.fn();
const mockAdminFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: mockAdminFrom })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { registerForEvent, unregisterFromEvent } from "@/lib/registrations/mutations";
import { joinWaitlist, leaveWaitlist } from "@/lib/events/mutations";

const mockRequireAuthenticatedProfile = vi.mocked(requireAuthenticatedProfile);

const EVENT_ID = "123e4567-e89b-12d3-a456-426614174000";
const ACTOR_ID = "323e4567-e89b-12d3-a456-426614174000";
const WAITING_USER_ID = "423e4567-e89b-12d3-a456-426614174000";

// ── Chain-builder stub (mirrors admin-set-component-lead.test.ts) ──

interface DbResult {
  data?: unknown | unknown[] | null;
  count?: number | null;
  error?: { message: string; code?: string } | null;
  singleData?: unknown;
}

function makeTableMock(result: DbResult = {}) {
  const chainValue = {
    data: Array.isArray(result.data) ? result.data : (result.data ?? null),
    count: result.count ?? null,
    error: result.error ?? null,
  };
  const thenable = Promise.resolve(chainValue);

  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(() =>
      Promise.resolve({
        data: Array.isArray(result.data) ? (result.data[0] ?? null) : (result.data ?? null),
        error: result.error ?? null,
      }),
    ),
    single: vi.fn(() =>
      Promise.resolve({
        data:
          result.singleData !== undefined
            ? result.singleData
            : Array.isArray(result.data)
              ? (result.data[0] ?? null)
              : (result.data ?? null),
        error: result.error ?? null,
      }),
    ),
    then: thenable.then.bind(thenable),
    catch: thenable.catch.bind(thenable),
    finally: thenable.finally.bind(thenable),
  };
  return builder;
}

interface ScriptStep {
  table: string;
  result?: DbResult;
}

/** Scripts a `.from(table)` mock so each call matches the expected table in order. */
function scriptFrom(fromMock: ReturnType<typeof vi.fn>, script: ScriptStep[]) {
  const builders: ReturnType<typeof makeTableMock>[] = [];
  let index = 0;
  fromMock.mockImplementation((table: string) => {
    const step = script[index];
    if (!step || step.table !== table) {
      throw new Error(
        `Unexpected table "${table}" at call ${index} (expected "${step?.table ?? "none"}")`,
      );
    }
    index += 1;
    const builder = makeTableMock(step.result);
    builders.push(builder);
    return builder;
  });
  return builders;
}

function setupClientScript(script: ScriptStep[]) {
  return scriptFrom(mockFrom, script);
}

function setupAdminScript(script: ScriptStep[]) {
  return scriptFrom(mockAdminFrom, script);
}

function actor(role: "member" | "admin" | "board_member" | "super_admin") {
  return {
    id: ACTOR_ID,
    role,
  } as unknown as Awaited<ReturnType<typeof requireAuthenticatedProfile>>;
}

describe("registerForEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockReturnValue({
      from: mockFrom,
    } as unknown as ReturnType<typeof createClient>);
    vi.mocked(createAdminClient).mockReturnValue({
      from: mockAdminFrom,
    } as unknown as ReturnType<typeof createAdminClient>);
    mockRequireAuthenticatedProfile.mockResolvedValue(actor("member"));
  });

  it("registers the member when there are free places and no deadline", async () => {
    setupClientScript([
      { table: "events", result: { data: [{ capacity: 10, registration_deadline: null }] } },
      { table: "event_registrations", result: { data: null, count: 1 } },
      { table: "event_registrations" },
    ]);

    const result = await registerForEvent({ eventId: EVENT_ID });

    expect(result).toEqual({ success: true, status: "registered" });
  });

  it("returns an error when the event does not exist", async () => {
    setupClientScript([{ table: "events", result: { data: [] } }]);

    const result = await registerForEvent({ eventId: EVENT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Evento no encontrado.");
  });

  it("joins the waitlist when the event is full and reports the position", async () => {
    setupClientScript([
      { table: "events", result: { data: [{ capacity: 2, registration_deadline: null }] } },
      { table: "event_registrations", result: { data: null, count: 2 } },
      // joinWaitlist re-checks capacity/deadline before inserting.
      { table: "events", result: { data: [{ capacity: 2, registration_deadline: null }] } },
      { table: "event_registrations", result: { data: null, count: 2 } },
      { table: "event_waitlist", result: { singleData: { position: 3 } } },
    ]);

    const result = await registerForEvent({ eventId: EVENT_ID });

    expect(result).toEqual({ success: true, status: "waitlisted", position: 3 });
  });

  it("joins the waitlist when the registration deadline has passed", async () => {
    setupClientScript([
      {
        table: "events",
        result: { data: [{ capacity: null, registration_deadline: "2020-01-01T00:00:00Z" }] },
      },
      { table: "event_registrations", result: { data: null, count: 0 } },
      // joinWaitlist re-checks capacity/deadline before inserting.
      {
        table: "events",
        result: { data: [{ capacity: null, registration_deadline: "2020-01-01T00:00:00Z" }] },
      },
      { table: "event_registrations", result: { data: null, count: 0 } },
      { table: "event_waitlist", result: { singleData: { position: 1 } } },
    ]);

    const result = await registerForEvent({ eventId: EVENT_ID });

    expect(result).toEqual({ success: true, status: "waitlisted", position: 1 });
  });

  it("falls back to the waitlist when the capacity trigger fires mid-insert (race)", async () => {
    setupClientScript([
      { table: "events", result: { data: [{ capacity: 5, registration_deadline: null }] } },
      { table: "event_registrations", result: { data: null, count: 1 } },
      {
        table: "event_registrations",
        result: { error: { message: "Event capacity reached for event xyz", code: "P0001" } },
      },
      // joinWaitlist re-checks capacity/deadline: the race filled the event
      // (the capacity trigger fired), so the waitlist path is legitimate.
      { table: "events", result: { data: [{ capacity: 5, registration_deadline: null }] } },
      { table: "event_registrations", result: { data: null, count: 5 } },
      { table: "event_waitlist", result: { singleData: { position: 2 } } },
    ]);

    const result = await registerForEvent({ eventId: EVENT_ID });

    expect(result).toEqual({ success: true, status: "waitlisted", position: 2 });
  });

  it("reports a duplicate registration with a friendly message", async () => {
    setupClientScript([
      { table: "events", result: { data: [{ capacity: null, registration_deadline: null }] } },
      { table: "event_registrations", result: { data: null, count: 0 } },
      {
        table: "event_registrations",
        result: { error: { code: "23505", message: "duplicate key" } },
      },
    ]);

    const result = await registerForEvent({ eventId: EVENT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Ya estás inscrito en este evento.");
  });

  it("returns an error for invalid input", async () => {
    const result = await registerForEvent({ eventId: "not-a-uuid" });
    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("joinWaitlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockReturnValue({
      from: mockFrom,
    } as unknown as ReturnType<typeof createClient>);
    mockRequireAuthenticatedProfile.mockResolvedValue(actor("member"));
  });

  it("rejects joining when the event does not exist", async () => {
    setupClientScript([{ table: "events", result: { data: [] } }]);

    const result = await joinWaitlist({ eventId: EVENT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Evento no encontrado.");
    expect(mockFrom).toHaveBeenCalledWith("events");
  });

  it("rejects joining when the event still has free places", async () => {
    const builders = setupClientScript([
      { table: "events", result: { data: [{ capacity: 10, registration_deadline: null }] } },
      { table: "event_registrations", result: { data: null, count: 1 } },
    ]);

    const result = await joinWaitlist({ eventId: EVENT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe("El evento tiene plazas disponibles. Apúntate directamente.");
    // Never reached the waitlist insert.
    expect(builders[1]!.insert).not.toHaveBeenCalled();
  });

  it("inserts the member and returns their assigned position when the event is full", async () => {
    const builders = setupClientScript([
      { table: "events", result: { data: [{ capacity: 2, registration_deadline: null }] } },
      { table: "event_registrations", result: { data: null, count: 2 } },
      { table: "event_waitlist", result: { singleData: { position: 4 } } },
    ]);

    const result = await joinWaitlist({ eventId: EVENT_ID });

    expect(result).toEqual({ success: true, position: 4 });
    expect(builders[2]!.insert).toHaveBeenCalledWith({
      event_id: EVENT_ID,
      user_id: ACTOR_ID,
    });
  });

  it("inserts the member when the registration deadline has passed", async () => {
    setupClientScript([
      {
        table: "events",
        result: { data: [{ capacity: null, registration_deadline: "2020-01-01T00:00:00Z" }] },
      },
      { table: "event_registrations", result: { data: null, count: 0 } },
      { table: "event_waitlist", result: { singleData: { position: 1 } } },
    ]);

    const result = await joinWaitlist({ eventId: EVENT_ID });

    expect(result).toEqual({ success: true, position: 1 });
  });

  it("reports a duplicate waitlist entry with a friendly message", async () => {
    setupClientScript([
      { table: "events", result: { data: [{ capacity: 1, registration_deadline: null }] } },
      { table: "event_registrations", result: { data: null, count: 1 } },
      { table: "event_waitlist", result: { error: { code: "23505", message: "duplicate key" } } },
    ]);

    const result = await joinWaitlist({ eventId: EVENT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Ya estás en la lista de espera.");
  });
});

describe("leaveWaitlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockReturnValue({
      from: mockFrom,
    } as unknown as ReturnType<typeof createClient>);
    mockRequireAuthenticatedProfile.mockResolvedValue(actor("member"));
  });

  it("deletes the caller's own waitlist entry", async () => {
    const builders = setupClientScript([{ table: "event_waitlist" }]);

    const result = await leaveWaitlist({ eventId: EVENT_ID });

    expect(result.success).toBe(true);
    expect(builders[0]!.delete).toHaveBeenCalledWith();
    expect(builders[0]!.eq).toHaveBeenCalledWith("event_id", EVENT_ID);
    expect(builders[0]!.eq).toHaveBeenCalledWith("user_id", ACTOR_ID);
  });
});

describe("unregisterFromEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(createClient).mockReturnValue({
      from: mockFrom,
    } as unknown as ReturnType<typeof createClient>);
    vi.mocked(createAdminClient).mockReturnValue({
      from: mockAdminFrom,
    } as unknown as ReturnType<typeof createAdminClient>);
    mockRequireAuthenticatedProfile.mockResolvedValue(actor("member"));
  });

  it("promotes the first waiting member after a successful unregistration", async () => {
    const client = setupClientScript([{ table: "event_registrations" }]);
    const admin = setupAdminScript([
      { table: "events", result: { data: [{ capacity: 5 }] } },
      { table: "event_registrations", result: { data: null, count: 4 } },
      { table: "event_waitlist", result: { data: [{ id: "entry-1", user_id: WAITING_USER_ID }] } },
      { table: "event_registrations" },
      { table: "event_waitlist" },
    ]);

    const result = await unregisterFromEvent({ eventId: EVENT_ID });

    expect(result.success).toBe(true);
    expect(client[0]!.delete).toHaveBeenCalledWith();
    // The freed spot was handed to the first waiting member.
    expect(admin[3]!.insert).toHaveBeenCalledWith({
      event_id: EVENT_ID,
      user_id: WAITING_USER_ID,
    });
    expect(admin[4]!.update).toHaveBeenCalledWith({
      status: "promoted",
      promoted_at: expect.any(String),
    });
    expect(admin[4]!.eq).toHaveBeenCalledWith("id", "entry-1");
  });

  it("does not break the unregistration when the promotion fails unexpectedly", async () => {
    setupClientScript([{ table: "event_registrations" }]);
    mockAdminFrom.mockImplementation(() => {
      throw new Error("unexpected admin failure");
    });
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await unregisterFromEvent({ eventId: EVENT_ID });

    expect(result.success).toBe(true);
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
