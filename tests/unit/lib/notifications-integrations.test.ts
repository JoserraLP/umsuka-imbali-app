import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (hoisted above the imports below by vitest) ──

const mockUserFrom = vi.fn();
const mockAdminFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ from: mockUserFrom })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: mockAdminFrom })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

vi.mock("@/lib/notifications/emit", () => ({
  notifyUsers: vi.fn(),
  getAllActiveMemberIds: vi.fn(),
  resolveEventRecipients: vi.fn(),
}));

import { requireAuthenticatedProfile } from "@/lib/auth/session";
import {
  notifyUsers,
  getAllActiveMemberIds,
  resolveEventRecipients,
} from "@/lib/notifications/emit";
import type { AuthenticatedProfile } from "@/types/auth";
import { createEvent } from "@/lib/events/mutations";
import type { CreateEventInput } from "@/lib/events/schema";
import { createNews } from "@/lib/news/mutations";
import { createVoting } from "@/lib/votings/mutations";
import { assignMemberToShift } from "@/lib/shifts/assignments";
import { approveUser } from "@/lib/approvals/mutations";

const mockRequireAuthenticatedProfile = vi.mocked(requireAuthenticatedProfile);
const mockNotifyUsers = vi.mocked(notifyUsers);

const EVENT_ID = "123e4567-e89b-12d3-a456-426614174000";
const NEWS_ID = "123e4567-e89b-12d3-a456-426614174001";
const VOTING_ID = "123e4567-e89b-12d3-a456-426614174002";
const SHIFT_ID = "123e4567-e89b-12d3-a456-426614174003";
const ACTOR_ID = "223e4567-e89b-12d3-a456-426614174000";
const USER_A = "323e4567-e89b-12d3-a456-426614174000";
const USER_B = "423e4567-e89b-12d3-a456-426614174000";
const USER_C = "523e4567-e89b-12d3-a456-426614174000";

// ── Scripted supabase mock (events-audience test pattern) ──

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
    lt: vi.fn(() => builder),
    gt: vi.fn(() => builder),
    neq: vi.fn(() => builder),
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

let userQueue: DbStep[] = [];
let adminQueue: DbStep[] = [];
let userCalls: Array<{ table: string; builder: ChainBuilder }> = [];
let adminCalls: Array<{ table: string; builder: ChainBuilder }> = [];

function scriptUserDb(steps: DbStep[]) {
  userQueue = [...steps];
  userCalls = [];
}

function scriptAdminDb(steps: DbStep[]) {
  adminQueue = [...steps];
  adminCalls = [];
}

mockUserFrom.mockImplementation((table: string) => {
  const step = userQueue.shift();
  if (!step || step.table !== table) {
    const expected = step ? `"${step.table}"` : "no more DB calls";
    throw new Error(`Unexpected query on table "${table}" — expected ${expected}`);
  }
  const builder = makeTableMock(step.result ?? {});
  userCalls.push({ table, builder });
  return builder;
});

mockAdminFrom.mockImplementation((table: string) => {
  const step = adminQueue.shift();
  if (!step || step.table !== table) {
    const expected = step ? `"${step.table}"` : "no more DB calls";
    throw new Error(`Unexpected admin query on table "${table}" — expected ${expected}`);
  }
  const builder = makeTableMock(step.result ?? {});
  adminCalls.push({ table, builder });
  return builder;
});

// ── Fixtures ───────────────────────────────────────────

function makeActor(overrides: Partial<AuthenticatedProfile> = {}): AuthenticatedProfile {
  return {
    id: ACTOR_ID,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@umsuka.org",
    avatarUrl: null,
    role: "super_admin",
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

const ACTOR = makeActor();

function createInput(overrides: Record<string, unknown> = {}): CreateEventInput {
  return {
    title: "Evento general",
    description: "Descripción del evento",
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

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  scriptUserDb([]);
  scriptAdminDb([]);
  mockRequireAuthenticatedProfile.mockResolvedValue(ACTOR);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

// ── createEvent → notifyUsers ──────────────────────────

describe("createEvent notification wiring", () => {
  it("notifies the resolved audience for audience 'all' with the event link", async () => {
    scriptUserDb([{ table: "events", result: { singleData: { id: EVENT_ID } } }]);
    vi.mocked(resolveEventRecipients).mockResolvedValue([USER_A, USER_B]);

    const result = await createEvent(createInput({ audienceType: "all" }));

    expect(result).toEqual({ success: true, id: EVENT_ID });
    expect(resolveEventRecipients).toHaveBeenCalledWith({
      audience_type: "all",
      audience_workgroup: null,
      audience_member_type: null,
      audience_user_ids: [],
    });
    expect(mockNotifyUsers).toHaveBeenCalledWith({
      userIds: [USER_A, USER_B],
      type: "event_created",
      title: "Nuevo evento: Evento general",
      message: "Descripción del evento",
      link: `/events/${EVENT_ID}`,
    });
  });

  it("passes the workgroup audience to the resolver and notifies its members", async () => {
    scriptUserDb([{ table: "events", result: { singleData: { id: EVENT_ID } } }]);
    vi.mocked(resolveEventRecipients).mockResolvedValue([USER_A]);

    const result = await createEvent(
      createInput({ audienceType: "workgroup", audienceWorkgroup: "barra" }),
    );

    expect(result.success).toBe(true);
    expect(resolveEventRecipients).toHaveBeenCalledWith({
      audience_type: "workgroup",
      audience_workgroup: "barra",
      audience_member_type: null,
      audience_user_ids: [],
    });
    expect(mockNotifyUsers).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: [USER_A], type: "event_created" }),
    );
  });

  it("stores the specific_users rows before notifying the listed users", async () => {
    scriptUserDb([
      { table: "events", result: { singleData: { id: EVENT_ID } } },
      { table: "event_audience_users" },
      { table: "event_audience_users" },
    ]);
    vi.mocked(resolveEventRecipients).mockResolvedValue([USER_A, USER_B]);

    const result = await createEvent(
      createInput({ audienceType: "specific_users", audienceUserIds: [USER_A, USER_B] }),
    );

    expect(result.success).toBe(true);
    expect(userCalls.map((c) => c.table)).toEqual([
      "events",
      "event_audience_users",
      "event_audience_users",
    ]);
    expect(mockNotifyUsers).toHaveBeenCalledWith({
      userIds: [USER_A, USER_B],
      type: "event_created",
      title: "Nuevo evento: Evento general",
      message: "Descripción del evento",
      link: `/events/${EVENT_ID}`,
    });
  });
});

// ── createNews → notifyUsers ───────────────────────────

describe("createNews notification wiring", () => {
  const newsInput = {
    title: "Noticia de prueba",
    content: "Contenido de la noticia",
    image_url: null,
    published: true,
    pinned: false,
  };

  it("notifies every active member only for published news", async () => {
    scriptUserDb([{ table: "news", result: { singleData: { id: NEWS_ID } } }]);
    vi.mocked(getAllActiveMemberIds).mockResolvedValue([USER_A, USER_B, USER_C]);

    const result = await createNews(newsInput);

    expect(result).toEqual({ success: true, id: NEWS_ID });
    expect(getAllActiveMemberIds).toHaveBeenCalledTimes(1);
    expect(mockNotifyUsers).toHaveBeenCalledWith({
      userIds: [USER_A, USER_B, USER_C],
      type: "news_created",
      title: "Nueva noticia: Noticia de prueba",
      message: undefined,
      link: `/news/${NEWS_ID}`,
    });
  });

  it("stays silent for drafts (published = false)", async () => {
    scriptUserDb([{ table: "news", result: { singleData: { id: NEWS_ID } } }]);

    const result = await createNews({ ...newsInput, published: false });

    expect(result.success).toBe(true);
    expect(getAllActiveMemberIds).not.toHaveBeenCalled();
    expect(mockNotifyUsers).not.toHaveBeenCalled();
  });
});

// ── createVoting → notifyUsers ─────────────────────────

describe("createVoting notification wiring", () => {
  it("notifies every active member after the voting and options are stored", async () => {
    scriptUserDb([
      { table: "votings", result: { singleData: { id: VOTING_ID } } },
      { table: "voting_options" },
    ]);
    vi.mocked(getAllActiveMemberIds).mockResolvedValue([USER_A]);

    const result = await createVoting({
      title: "¿Dónde ensayamos?",
      description: "Elegimos sede del ensayo.",
      voting_deadline: null,
      options: ["Casa de la Cultura", "Centro Cívico"],
    });

    expect(result).toEqual({ success: true, id: VOTING_ID });
    expect(userCalls.map((c) => c.table)).toEqual(["votings", "voting_options"]);
    expect(mockNotifyUsers).toHaveBeenCalledWith({
      userIds: [USER_A],
      type: "voting_created",
      title: "Nueva votación: ¿Dónde ensayamos?",
      message: undefined,
      link: `/votings/${VOTING_ID}`,
    });
  });
});

// ── assignMemberToShift → notifyUsers ──────────────────

describe("assignMemberToShift notification wiring", () => {
  it("notifies the assigned member with the shift name and event title", async () => {
    scriptUserDb([
      // assertCanAssign: shift lookup + event lookup
      { table: "shifts", result: { singleData: { event_id: EVENT_ID, workgroup: null } } },
      {
        table: "events",
        result: { singleData: { event_type: "work_shift", created_by: ACTOR_ID } },
      },
      // full shift details
      {
        table: "shifts",
        result: {
          singleData: {
            id: SHIFT_ID,
            event_id: EVENT_ID,
            name: "Barra principal",
            start_time: "2026-09-01T18:00:00.000Z",
            end_time: "2026-09-01T22:00:00.000Z",
            max_assignees: null,
            workgroup: null,
          },
        },
      },
      // duplicate check (none)
      { table: "shift_assignments", result: { maybeSingleData: null } },
      // time conflicts (none)
      { table: "shift_assignments", result: { data: [] } },
      // the assignment insert
      { table: "shift_assignments" },
      // event title for the notification message
      { table: "events", result: { maybeSingleData: { title: "Ensayo de carnaval" } } },
    ]);

    const result = await assignMemberToShift({ shiftId: SHIFT_ID, userId: USER_A });

    expect(result).toEqual({ success: true });
    expect(mockNotifyUsers).toHaveBeenCalledWith({
      userIds: [USER_A],
      type: "shift_assigned",
      title: "Turno asignado: Barra principal",
      message: "Ensayo de carnaval",
      link: `/events/${EVENT_ID}`,
    });
  });
});

// ── approveUser → notifyUsers ──────────────────────────

describe("approveUser notification wiring", () => {
  it("notifies the approved user after the profile update", async () => {
    scriptAdminDb([{ table: "profiles" }]);

    const result = await approveUser({ userId: USER_B });

    expect(result).toEqual({ success: true });
    expect(mockNotifyUsers).toHaveBeenCalledWith({
      userIds: [USER_B],
      type: "profile_approved",
      title: "¡Tu cuenta ha sido aprobada!",
      message: "Ya puedes acceder a la app.",
      link: "/dashboard",
    });
  });
});

// ── Emitter failures never break the mutation ──────────

describe("emitter failure resilience", () => {
  it("createNews still succeeds when notifyUsers rejects", async () => {
    scriptUserDb([{ table: "news", result: { singleData: { id: NEWS_ID } } }]);
    vi.mocked(getAllActiveMemberIds).mockResolvedValue([USER_A]);
    mockNotifyUsers.mockRejectedValue(new Error("emitter boom"));

    const result = await createNews({
      title: "Noticia de prueba",
      content: "Contenido de la noticia",
      image_url: null,
      published: true,
      pinned: false,
    });

    expect(result).toEqual({ success: true, id: NEWS_ID });
    expect(mockNotifyUsers).toHaveBeenCalledTimes(1);
    expect(errorSpy).toHaveBeenCalled();
  });
});
