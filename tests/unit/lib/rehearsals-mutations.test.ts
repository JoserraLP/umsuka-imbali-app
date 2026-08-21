import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted above the imports below by vitest) ──

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import {
  markRehearsalAttendance,
  markMultipleRehearsalAttendance,
  clearRehearsalSession,
} from "@/lib/rehearsals/mutations";
import type { AuthenticatedProfile } from "@/types/auth";

const mockFrom = vi.fn();

const EVENT_ID = "123e4567-e89b-12d3-a456-426614174001";
const USER_ID = "123e4567-e89b-12d3-a456-426614174002";
const ACTOR_ID = "123e4567-e89b-12d3-a456-426614174003";

// ── Chain-builder stub ────────────────────────────────
// `selectResult` feeds .maybeSingle()/.single() AND awaited select/delete
// chains; `awaitedUpsert` feeds awaited upsert chains.

interface QueryResult {
  data?: unknown[] | null;
  error?: Error | null;
}

function makeTableMock(
  selectResult: QueryResult = { data: null, error: null },
  awaitedUpsert: QueryResult = selectResult,
) {
  const resolveSingle = () =>
    Promise.resolve(
      Array.isArray(selectResult.data)
        ? { data: selectResult.data[0] ?? null, error: selectResult.error ?? null }
        : selectResult,
    );

  const selectThenable = Promise.resolve(selectResult);
  const upsertThenable = Promise.resolve(awaitedUpsert);
  const deleteThenable = Promise.resolve({ data: null, error: null });

  let lastOp: "select" | "upsert" | "delete" = "select";

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    in: vi.fn(() => builder),
    delete: vi.fn(() => {
      lastOp = "delete";
      return builder;
    }),
    upsert: vi.fn((_payload: unknown, _options?: unknown) => {
      lastOp = "upsert";
      return builder;
    }),
    maybeSingle: vi.fn(resolveSingle),
    single: vi.fn(resolveSingle),
    then: (
      onfulfilled?: ((value: QueryResult | { data: null; error: null }) => unknown) | null,
      onrejected?: ((reason: unknown) => unknown) | null,
    ) =>
      (lastOp === "upsert"
        ? upsertThenable
        : lastOp === "delete"
          ? deleteThenable
          : selectThenable
      ).then(onfulfilled as never, onrejected as never),
    catch: (onrejected?: ((reason: unknown) => unknown) | null) =>
      (lastOp === "upsert" ? upsertThenable : selectThenable).catch(onrejected),
    finally: (onfinally?: (() => void) | null) =>
      (lastOp === "upsert" ? upsertThenable : selectThenable).finally(onfinally),
  };

  return builder;
}

type TableKey = "events" | "rehearsal_attendance";

function setupTables(
  tables: Partial<Record<TableKey, { select?: QueryResult; awaitedUpsert?: QueryResult }>> = {},
) {
  const builders: Record<TableKey, ReturnType<typeof makeTableMock>> = {
    // Default: a valid rehearsal with both sessions enabled — individual
    // tests override only the table they care about.
    events: makeTableMock(tables.events?.select ?? { data: [rehearsalEvent()] }),
    rehearsal_attendance: makeTableMock(
      tables.rehearsal_attendance?.select ?? { data: null, error: null },
      tables.rehearsal_attendance?.awaitedUpsert ?? { data: null, error: null },
    ),
  };

  mockFrom.mockImplementation((table: string) => builders[table as TableKey] ?? makeTableMock());
  return builders;
}

// ── Fixtures ──────────────────────────────────────────

function actor(role: AuthenticatedProfile["role"] = "super_admin"): AuthenticatedProfile {
  return {
    id: ACTOR_ID,
    firstName: "Marta",
    lastName: "Admin",
    email: null,
    avatarUrl: null,
    role,
    componentType: "member",
    workgroup: "ninguno",
    isWorkgroupLead: false,
    componentLeadFor: null,
    birthDate: null,
    isActive: true,
    status: "active",
    username: null,
    authMethod: "google",
    bio: null,
    phone: null,
    skills: [],
    joinedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

/** Row shape returned by fetchRehearsalEvent on the events table. */
function rehearsalEvent(overrides: Record<string, unknown> = {}) {
  return { event_type: "rehearsal", morning_session: true, afternoon_session: true, ...overrides };
}

function validMarkInput() {
  return { eventId: EVENT_ID, userId: USER_ID, session: "morning" as const, attended: true };
}

async function expectRejectedAsMember(
  action: () => Promise<{ success: boolean; error?: string }>,
  errorMessage = "Solo la directiva puede registrar asistencia a ensayos.",
) {
  const result = await action();
  expect(result.success).toBe(false);
  expect(result.error).toBe(errorMessage);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFrom.mockReset();
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor());
  vi.mocked(createClient).mockResolvedValue({ from: mockFrom } as never);
  setupTables({ events: { select: { data: [rehearsalEvent()] } } });
});

// ── markRehearsalAttendance ───────────────────────────

describe("markRehearsalAttendance", () => {
  it("rejects members and other non-management roles before any DB call", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor("member"));
    await expectRejectedAsMember(() => markRehearsalAttendance(validMarkInput()));
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects an invalid session value before any DB call", async () => {
    const result = await markRehearsalAttendance({
      ...validMarkInput(),
      session: "evening" as never,
    });
    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("fails closed when the event lookup errors", async () => {
    setupTables({
      events: { select: { data: null, error: new Error("select failed") } },
    });

    const result = await markRehearsalAttendance(validMarkInput());

    expect(result).toEqual({ success: false, error: "select failed" });
  });

  it('returns "Evento no encontrado." when the event does not exist', async () => {
    setupTables({ events: { select: { data: [] } } });

    const result = await markRehearsalAttendance(validMarkInput());

    expect(result).toEqual({ success: false, error: "Evento no encontrado." });
  });

  it("rejects generic (non-rehearsal) events", async () => {
    setupTables({
      events: { select: { data: [rehearsalEvent({ event_type: "general" })] } },
    });

    const result = await markRehearsalAttendance(validMarkInput());

    expect(result).toEqual({
      success: false,
      error: "La asistencia por sesiones solo aplica a eventos de tipo ensayo.",
    });
  });

  it("rejects a session that the rehearsal does not enable", async () => {
    setupTables({
      events: { select: { data: [rehearsalEvent({ afternoon_session: false })] } },
    });

    const morning = await markRehearsalAttendance(validMarkInput());
    const afternoon = await markRehearsalAttendance({ ...validMarkInput(), session: "afternoon" });

    expect(morning.success).toBe(true);
    expect(afternoon).toEqual({ success: false, error: "Este ensayo no tiene sesión de tarde." });
  });

  it("upserts with the actor as marked_by and the triple conflict target", async () => {
    const builders = setupTables();

    const result = await markRehearsalAttendance(validMarkInput());

    expect(result).toEqual({ success: true });
    expect(builders.rehearsal_attendance.upsert).toHaveBeenCalledWith(
      {
        event_id: EVENT_ID,
        user_id: USER_ID,
        session: "morning",
        attended: true,
        marked_by: ACTOR_ID,
      },
      { onConflict: "event_id,user_id,session" },
    );
  });

  it("maps a unique violation to a friendly duplicate message", async () => {
    const duplicateKeyError = Object.assign(new Error("duplicate key"), { code: "23505" });
    setupTables({
      rehearsal_attendance: { awaitedUpsert: { data: null, error: duplicateKeyError } },
    });

    const result = await markRehearsalAttendance(validMarkInput());

    expect(result).toEqual({
      success: false,
      error: "Ya existe un registro de asistencia para esa sesión.",
    });
  });
});

// ── markMultipleRehearsalAttendance ───────────────────

describe("markMultipleRehearsalAttendance", () => {
  it("rejects members before any DB call", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor("member"));
    await expectRejectedAsMember(() =>
      markMultipleRehearsalAttendance({ records: [validMarkInput()] }),
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("validates the rehearsal once and upserts every record", async () => {
    const builders = setupTables();

    const result = await markMultipleRehearsalAttendance({
      records: [
        validMarkInput(),
        { ...validMarkInput(), userId: ACTOR_ID, session: "afternoon", attended: false },
      ],
    });

    expect(result).toEqual({ success: true });
    // events queried exactly once (single validation), two upserts.
    expect(mockFrom).toHaveBeenNthCalledWith(1, "events");
    expect(builders.rehearsal_attendance.upsert).toHaveBeenCalledTimes(2);
    expect(builders.rehearsal_attendance.upsert).toHaveBeenLastCalledWith(
      {
        event_id: EVENT_ID,
        user_id: ACTOR_ID,
        session: "afternoon",
        attended: false,
        marked_by: ACTOR_ID,
      },
      { onConflict: "event_id,user_id,session" },
    );
  });

  it("rejects a batch mixing several rehearsals", async () => {
    setupTables();
    const OTHER_EVENT = "223e4567-e89b-12d3-a456-426614174009";

    // The differing record comes second: the first is validated and
    // upserted before the loop reaches the mismatch and aborts.
    const result = await markMultipleRehearsalAttendance({
      records: [validMarkInput(), { ...validMarkInput(), eventId: OTHER_EVENT }],
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("mismo ensayo");
  });

  it("stops at the first failing record and reports the user id", async () => {
    const dbError = new Error("insert failed");
    setupTables({
      rehearsal_attendance: {
        awaitedUpsert: { data: null, error: dbError },
      },
    });

    const result = await markMultipleRehearsalAttendance({
      records: [validMarkInput()],
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(`Error for user ${USER_ID}: insert failed`);
  });
});

// ── clearRehearsalSession ─────────────────────────────

describe("clearRehearsalSession", () => {
  it("rejects members before any DB call", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor("member"));
    await expectRejectedAsMember(
      () => clearRehearsalSession({ eventId: EVENT_ID, session: "morning" }),
      "Solo la directiva puede gestionar asistencia a ensayos.",
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it('returns "Evento no encontrado." when the event is missing', async () => {
    setupTables({ events: { select: { data: [] } } });

    const result = await clearRehearsalSession({ eventId: EVENT_ID, session: "morning" });

    expect(result).toEqual({ success: false, error: "Evento no encontrado." });
  });

  it("deletes only the rows of the requested session", async () => {
    const builders = setupTables();

    const result = await clearRehearsalSession({ eventId: EVENT_ID, session: "afternoon" });

    expect(result).toEqual({ success: true });
    expect(builders.rehearsal_attendance.delete).toHaveBeenCalledTimes(1);
    // eq calls: event_id filter + session filter.
    expect(builders.rehearsal_attendance.eq).toHaveBeenCalledWith("event_id", EVENT_ID);
    expect(builders.rehearsal_attendance.eq).toHaveBeenCalledWith("session", "afternoon");
  });

  it("rejects clearing a disabled session without deleting anything", async () => {
    setupTables({
      events: { select: { data: [rehearsalEvent({ afternoon_session: false })] } },
    });

    const result = await clearRehearsalSession({ eventId: EVENT_ID, session: "afternoon" });

    expect(result).toEqual({ success: false, error: "Este ensayo no tiene sesión de tarde." });
    expect(mockFrom).toHaveBeenCalledTimes(1); // only the events lookup
  });
});
