import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by vitest) ──────────────────────────

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

vi.mock("@/lib/notifications/emit", () => ({
  notifyUsers: vi.fn().mockResolvedValue(undefined),
  getAllActiveMemberIds: vi.fn().mockResolvedValue([]),
  resolveEventRecipients: vi.fn().mockResolvedValue([]),
}));

import { requireAuthenticatedProfile } from "@/lib/auth/session";
import type { AuthenticatedProfile } from "@/types/auth";
import { createEventWithAudience, updateEvent } from "@/lib/events/mutations";
import type { CreateEventInput, UpdateEventInput } from "@/lib/events/schema";
import { updateEventAudience, type UpdateEventAudienceInput } from "@/lib/events/audience";

const mockRequireAuthenticatedProfile = vi.mocked(requireAuthenticatedProfile);

const EVENT_ID = "123e4567-e89b-12d3-a456-426614174000";
const OTHER_ID = "823e4567-e89b-12d3-a456-426614174000";
const USER_A = "223e4567-e89b-12d3-a456-426614174000";
const USER_B = "323e4567-e89b-12d3-a456-426614174000";

function makeActor(overrides: Partial<AuthenticatedProfile> = {}): AuthenticatedProfile {
  return {
    id: "999e4567-e89b-12d3-a456-426614174000",
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@umsuka.org",
    avatarUrl: null,
    role: "admin",
    componentType: "music",
    workgroup: "telas",
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
    createdAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

const MANAGEMENT_ACTOR = makeActor();
const LEAD_ACTOR = makeActor({
  id: "888e4567-e89b-12d3-a456-426614174000",
  role: "member",
  isWorkgroupLead: true,
  workgroup: "barra",
});
const MEMBER_ACTOR = makeActor({
  id: "777e4567-e89b-12d3-a456-426614174000",
  role: "member",
  isWorkgroupLead: false,
  workgroup: "barra",
});

// ── Scripted supabase mock ─────────────────────────────

interface DbResult {
  data?: unknown[] | null;
  error?: { message: string } | null;
  singleData?: unknown;
  maybeSingleData?: unknown;
}

interface DbStep {
  table: string;
  result?: DbResult;
}

/**
 * Chain builder mirroring the supabase-js query builder used by the
 * mutations: .insert/.select/.single()/... all return the builder, and
 * awaiting the builder resolves the configured result.
 */
function makeTableMock(result: DbResult = {}) {
  const thenValue = {
    data: Array.isArray(result.data) ? result.data : (result.data ?? null),
    count: null,
    error: result.error ?? null,
  };
  const thenable = Promise.resolve(thenValue);

  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(() =>
      Promise.resolve({ data: result.maybeSingleData ?? null, error: result.error ?? null }),
    ),
    single: vi.fn(() =>
      Promise.resolve({ data: result.singleData ?? null, error: result.error ?? null }),
    ),
    then: thenable.then.bind(thenable),
    catch: thenable.catch.bind(thenable),
    finally: thenable.finally.bind(thenable),
  };
  return builder;
}

type ChainBuilder = ReturnType<typeof makeTableMock>;

let dbQueue: DbStep[] = [];
let dbCalls: Array<{ table: string; builder: ChainBuilder }> = [];

function scriptDb(steps: DbStep[]) {
  dbQueue = [...steps];
  dbCalls = [];
}

mockFrom.mockImplementation((table: string) => {
  const step = dbQueue.shift();
  if (!step || step.table !== table) {
    const expected = step ? `"${step.table}"` : "no more DB calls";
    throw new Error(`Unexpected query on table "${table}" — expected ${expected}`);
  }
  const builder = makeTableMock(step.result ?? {});
  dbCalls.push({ table, builder });
  return builder;
});

/** Tables touched by the mutation, in call order. */
function queriedTables(): string[] {
  return dbCalls.map((c) => c.table);
}

/** Insert payload of the `events` insert (create flows). */
function eventInsertPayload(): Record<string, unknown> | undefined {
  const call = dbCalls.find((c) => c.table === "events");
  const firstCall = call?.builder.insert.mock.calls[0];
  if (!firstCall) {
    return undefined;
  }
  return (firstCall as unknown[])[0] as Record<string, unknown>;
}

/** Update payload of the `events` update (update flows). */
function eventUpdatePayload(): Record<string, unknown> | undefined {
  const calls = dbCalls.filter((c) => c.table === "events");
  for (const call of calls) {
    const first = call.builder.update.mock.calls[0];
    if (first) {
      return (first as unknown[])[0] as Record<string, unknown>;
    }
  }
  return undefined;
}

/** N-th `event_audience_users` chain builder (0-based). */
function audienceBuilder(index = 0): ChainBuilder {
  const calls: Array<{ table: string; builder: ChainBuilder }> = dbCalls.filter(
    (c) => c.table === "event_audience_users",
  );
  const call = calls[index];
  if (!call) {
    throw new Error(`No event_audience_users call #${index} — got ${queriedTables().join(", ")}`);
  }
  return call.builder;
}

// ── Input helpers ──────────────────────────────────────

function createInput(overrides: Record<string, unknown> = {}): CreateEventInput {
  return {
    title: "Evento general",
    description: "",
    eventType: "general",
    eventDate: "2026-09-01T18:30",
    capacity: null,
    location: "",
    imageUrl: "",
    registrationDeadline: "",
    workgroup: null,
    audienceType: "all",
    audienceWorkgroup: null,
    audienceMemberType: null,
    audienceUserIds: [],
    ...overrides,
  } as CreateEventInput;
}

function updateInput(overrides: Record<string, unknown> = {}): UpdateEventInput {
  return { ...createInput(overrides), id: EVENT_ID } as UpdateEventInput;
}

function audienceInput(overrides: Record<string, unknown> = {}): UpdateEventAudienceInput {
  return {
    eventId: EVENT_ID,
    audienceType: "all",
    audienceWorkgroup: null,
    audienceMemberType: null,
    audienceUserIds: [] as string[],
    ...overrides,
  } as UpdateEventAudienceInput;
}

beforeEach(() => {
  vi.clearAllMocks();
  scriptDb([]);
  mockRequireAuthenticatedProfile.mockResolvedValue(MANAGEMENT_ACTOR);
});

// ── createEventWithAudience ────────────────────────────

describe("createEventWithAudience", () => {
  it("creates an 'all' event and stores the audience columns", async () => {
    scriptDb([{ table: "events", result: { singleData: { id: EVENT_ID } } }]);

    const result = await createEventWithAudience(createInput({ audienceType: "all" }));

    expect(result).toEqual({ success: true, id: EVENT_ID });
    expect(queriedTables()).toEqual(["events"]);
    expect(eventInsertPayload()).toMatchObject({
      audience_type: "all",
      audience_workgroup: null,
      audience_member_type: null,
    });
  });

  it("creates a workgroup event with the group stored", async () => {
    scriptDb([{ table: "events", result: { singleData: { id: EVENT_ID } } }]);

    const result = await createEventWithAudience(
      createInput({ audienceType: "workgroup", audienceWorkgroup: "barra" }),
    );

    expect(result.success).toBe(true);
    expect(eventInsertPayload()).toMatchObject({
      audience_type: "workgroup",
      audience_workgroup: "barra",
      audience_member_type: null,
    });
  });

  it("creates a member_type event with the component stored", async () => {
    scriptDb([{ table: "events", result: { singleData: { id: EVENT_ID } } }]);

    const result = await createEventWithAudience(
      createInput({ audienceType: "member_type", audienceMemberType: "music" }),
    );

    expect(result.success).toBe(true);
    expect(eventInsertPayload()).toMatchObject({
      audience_type: "member_type",
      audience_workgroup: null,
      audience_member_type: "music",
    });
  });

  it("creates a specific_users event and replaces the audience rows", async () => {
    scriptDb([
      { table: "events", result: { singleData: { id: EVENT_ID } } },
      { table: "event_audience_users" },
      { table: "event_audience_users" },
    ]);

    const result = await createEventWithAudience(
      createInput({ audienceType: "specific_users", audienceUserIds: [USER_A, USER_B] }),
    );

    expect(result.success).toBe(true);
    expect(queriedTables()).toEqual([
      "events",
      "event_audience_users",
      "event_audience_users",
    ]);
    expect(eventInsertPayload()).toMatchObject({ audience_type: "specific_users" });
    // replaceAudienceUsers deletes the existing rows, then inserts the new ones.
    expect(audienceBuilder(0).delete).toHaveBeenCalled();
    expect(audienceBuilder(0).eq).toHaveBeenCalledWith("event_id", EVENT_ID);
    expect(audienceBuilder(1).insert).toHaveBeenCalledWith([
      { event_id: EVENT_ID, user_id: USER_A },
      { event_id: EVENT_ID, user_id: USER_B },
    ]);
  });

  it("compensates by deleting the event when the audience rows fail", async () => {
    scriptDb([
      { table: "events", result: { singleData: { id: EVENT_ID } } },
      { table: "event_audience_users", result: { error: { message: "violation" } } },
      { table: "events" },
    ]);

    const result = await createEventWithAudience(
      createInput({ audienceType: "specific_users", audienceUserIds: [USER_A] }),
    );

    expect(result).toEqual({
      success: false,
      error: "No se pudo guardar la audiencia del evento.",
    });
    const calls = dbCalls.filter((c) => c.table === "events");
    expect(calls[1]!.builder.delete).toHaveBeenCalled();
    expect(calls[1]!.builder.eq).toHaveBeenCalledWith("id", EVENT_ID);
  });

  it("lets a workgroup lead create a work_shift event with audience forced to 'all'", async () => {
    mockRequireAuthenticatedProfile.mockResolvedValue(LEAD_ACTOR);
    scriptDb([
      { table: "events", result: { singleData: { id: EVENT_ID } } },
      { table: "shifts" },
    ]);

    const result = await createEventWithAudience(
      createInput({ eventType: "work_shift", workgroup: "barra" }),
    );

    expect(result.success).toBe(true);
    expect(queriedTables()).toEqual(["events", "shifts"]);
    expect(eventInsertPayload()).toMatchObject({
      audience_type: "all",
      audience_workgroup: null,
      audience_member_type: null,
      visible_to_group: "barra",
    });
  });

  it("rejects a tampered audience on a work_shift event before any DB call", async () => {
    mockRequireAuthenticatedProfile.mockResolvedValue(LEAD_ACTOR);

    const result = await createEventWithAudience(
      createInput({
        eventType: "work_shift",
        workgroup: "barra",
        audienceType: "specific_users",
        audienceUserIds: [USER_A],
      }),
    );

    expect(result).toEqual({
      success: false,
      error: "Los eventos de trabajo solo pueden mostrarse a su grupo de trabajo.",
    });
    expect(queriedTables()).toEqual([]);
  });

  it("rejects a lead creating a work_shift event for another group", async () => {
    mockRequireAuthenticatedProfile.mockResolvedValue(LEAD_ACTOR);

    const result = await createEventWithAudience(
      createInput({ eventType: "work_shift", workgroup: "telas" }),
    );

    expect(result).toEqual({
      success: false,
      error: "Solo puedes crear eventos de tipo trabajo para tu propio grupo.",
    });
    expect(queriedTables()).toEqual([]);
  });

  it("rejects non-management members creating general events", async () => {
    mockRequireAuthenticatedProfile.mockResolvedValue(MEMBER_ACTOR);

    const result = await createEventWithAudience(createInput({ audienceType: "all" }));

    expect(result).toEqual({
      success: false,
      error: "No tienes permisos para realizar esta acción.",
    });
    expect(queriedTables()).toEqual([]);
  });
});

// ── updateEvent ────────────────────────────────────────

describe("updateEvent audience handling", () => {
  const EXISTING_GENERAL = {
    created_by: OTHER_ID,
    event_type: "general",
    audience_type: "all",
  };

  it("stores the new audience columns and replaces rows for specific_users", async () => {
    scriptDb([
      { table: "events", result: { singleData: EXISTING_GENERAL } },
      { table: "events" },
      { table: "event_audience_users" },
      { table: "event_audience_users" },
    ]);

    const result = await updateEvent(
      updateInput({ audienceType: "specific_users", audienceUserIds: [USER_A] }),
    );

    expect(result.success).toBe(true);
    expect(queriedTables()).toEqual([
      "events",
      "events",
      "event_audience_users",
      "event_audience_users",
    ]);
    expect(eventUpdatePayload()).toMatchObject({
      audience_type: "specific_users",
      audience_workgroup: null,
      audience_member_type: null,
    });
    expect(audienceBuilder(0).delete).toHaveBeenCalled();
    expect(audienceBuilder(1).insert).toHaveBeenCalledWith([
      { event_id: EVENT_ID, user_id: USER_A },
    ]);
  });

  it("deletes the old rows when leaving specific_users", async () => {
    scriptDb([
      { table: "events", result: { singleData: { ...EXISTING_GENERAL, audience_type: "specific_users" } } },
      { table: "events" },
      { table: "event_audience_users" },
    ]);

    const result = await updateEvent(updateInput({ audienceType: "all" }));

    expect(result.success).toBe(true);
    expect(eventUpdatePayload()).toMatchObject({
      audience_type: "all",
      audience_workgroup: null,
      audience_member_type: null,
    });
    expect(audienceBuilder(0).delete).toHaveBeenCalled();
    expect(audienceBuilder(0).insert).not.toHaveBeenCalled();
  });

  it("forces audience 'all' when management updates a work_shift event", async () => {
    scriptDb([
      { table: "events", result: { singleData: { created_by: OTHER_ID, event_type: "work_shift", audience_type: "all" } } },
      { table: "events" },
    ]);

    const result = await updateEvent(
      updateInput({ eventType: "work_shift", workgroup: "barra", audienceType: "all" }),
    );

    expect(result.success).toBe(true);
    expect(queriedTables()).toEqual(["events", "events"]);
    expect(eventUpdatePayload()).toMatchObject({
      audience_type: "all",
      audience_workgroup: null,
      audience_member_type: null,
    });
  });

  it("lets a lead edit their own work_shift event with the group pinned", async () => {
    mockRequireAuthenticatedProfile.mockResolvedValue(LEAD_ACTOR);
    scriptDb([
      { table: "events", result: { singleData: { created_by: LEAD_ACTOR.id, event_type: "work_shift", audience_type: "all" } } },
      { table: "events" },
    ]);

    const result = await updateEvent(
      updateInput({ eventType: "work_shift", workgroup: "telas", audienceType: "all" }),
    );

    expect(result.success).toBe(true);
    expect(eventUpdatePayload()).toMatchObject({
      audience_type: "all",
      visible_to_group: "barra",
      created_by_workgroup: "barra",
    });
  });

  it("rejects a lead editing someone else's work_shift event", async () => {
    mockRequireAuthenticatedProfile.mockResolvedValue(LEAD_ACTOR);
    scriptDb([
      { table: "events", result: { singleData: { created_by: OTHER_ID, event_type: "work_shift", audience_type: "all" } } },
    ]);

    const result = await updateEvent(
      updateInput({ eventType: "work_shift", workgroup: "barra" }),
    );

    expect(result).toEqual({
      success: false,
      error: "No tienes permiso para editar este evento.",
    });
    expect(queriedTables()).toEqual(["events"]);
  });
});

// ── updateEventAudience ────────────────────────────────

describe("updateEventAudience", () => {
  const GENERAL = { created_by: OTHER_ID, event_type: "general" };

  it("reconfigures the audience of an existing event (management)", async () => {
    scriptDb([
      { table: "events", result: { maybeSingleData: GENERAL } },
      { table: "events" },
      { table: "event_audience_users" },
    ]);

    const result = await updateEventAudience(
      audienceInput({ audienceType: "workgroup", audienceWorkgroup: "barra" }),
    );

    expect(result).toEqual({ success: true });
    expect(queriedTables()).toEqual(["events", "events", "event_audience_users"]);
    expect(eventUpdatePayload()).toMatchObject({
      audience_type: "workgroup",
      audience_workgroup: "barra",
    });
    // No rows to insert for a workgroup audience: delete only.
    expect(audienceBuilder(0).insert).not.toHaveBeenCalled();
  });

  it("replaces concrete user rows for specific_users", async () => {
    scriptDb([
      { table: "events", result: { maybeSingleData: GENERAL } },
      { table: "events" },
      { table: "event_audience_users" },
      { table: "event_audience_users" },
    ]);

    const result = await updateEventAudience(
      audienceInput({ audienceType: "specific_users", audienceUserIds: [USER_A, USER_B] }),
    );

    expect(result).toEqual({ success: true });
    expect(audienceBuilder(0).delete).toHaveBeenCalled();
    expect(audienceBuilder(1).insert).toHaveBeenCalledWith([
      { event_id: EVENT_ID, user_id: USER_A },
      { event_id: EVENT_ID, user_id: USER_B },
    ]);
  });

  it("rejects non-management creators when they configure an audience", async () => {
    // updateEventAudience authz lets the creator in, but audience
    // configuration itself is management-only (resolveAudienceFields).
    mockRequireAuthenticatedProfile.mockResolvedValue(MEMBER_ACTOR);
    scriptDb([
      { table: "events", result: { maybeSingleData: { created_by: MEMBER_ACTOR.id, event_type: "general" } } },
    ]);

    const result = await updateEventAudience(
      audienceInput({ audienceType: "member_type", audienceMemberType: "dance" }),
    );

    expect(result).toEqual({
      success: false,
      error: "Solo la gestión puede elegir la audiencia de un evento.",
    });
    expect(queriedTables()).toEqual(["events"]);
  });

  it("rejects non-management actors who did not create the event", async () => {
    mockRequireAuthenticatedProfile.mockResolvedValue(MEMBER_ACTOR);
    scriptDb([{ table: "events", result: { maybeSingleData: GENERAL } }]);

    const result = await updateEventAudience(audienceInput({}));

    expect(result).toEqual({
      success: false,
      error: "No tienes permiso para modificar la audiencia de este evento.",
    });
    expect(queriedTables()).toEqual(["events"]);
  });

  it("rejects work_shift events (audience is pinned to the group)", async () => {
    scriptDb([
      { table: "events", result: { maybeSingleData: { created_by: OTHER_ID, event_type: "work_shift" } } },
    ]);

    const result = await updateEventAudience(audienceInput({}));

    expect(result).toEqual({
      success: false,
      error: "Los eventos de trabajo solo pueden mostrarse a su grupo de trabajo.",
    });
    expect(queriedTables()).toEqual(["events"]);
  });

  it("returns Evento no encontrado for a missing event", async () => {
    scriptDb([{ table: "events", result: {} }]);

    const result = await updateEventAudience(audienceInput({}));

    expect(result).toEqual({ success: false, error: "Evento no encontrado." });
  });
});