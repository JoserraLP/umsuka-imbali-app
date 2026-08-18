import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (hoisted above the imports below by vitest) ──

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: mockFrom })),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import {
  getAllActiveMemberIds,
  resolveEventRecipients,
  notifyUsers,
} from "@/lib/notifications/emit";

const USER_A = "323e4567-e89b-12d3-a456-426614174000";
const USER_B = "423e4567-e89b-12d3-a456-426614174000";
const USER_C = "523e4567-e89b-12d3-a456-426614174000";

// ── Chain-builder stub (mirrors votings-mutations test pattern) ──

interface QueryResult {
  data?: unknown[] | null;
  error?: Error | null;
}

/**
 * Builds a chainable table stub. `selectResult` feeds awaited select
 * chains; `awaitedResult` feeds awaited insert chains (defaults to the
 * select result). `.in`/`.eq`/`.order` etc. are included so tests can
 * assert the exact filters the emitter builds.
 */
function makeTableMock(
  selectResult: QueryResult = { data: null, error: null },
  awaitedResult: QueryResult = selectResult,
) {
  const selectThenable = Promise.resolve(selectResult);
  const awaitedThenable = Promise.resolve(awaitedResult);

  let lastOp: "select" | "insert" = "select";

  const builder = {
    select: vi.fn(() => {
      lastOp = "select";
      return builder;
    }),
    in: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    insert: vi.fn((_payload: unknown) => {
      lastOp = "insert";
      return builder;
    }),
    then: (
      onfulfilled?: ((value: QueryResult) => QueryResult | PromiseLike<QueryResult>) | null,
      onrejected?: ((reason: unknown) => QueryResult | PromiseLike<QueryResult>) | null,
    ) => (lastOp === "insert" ? awaitedThenable : selectThenable).then(onfulfilled, onrejected),
    catch: (onrejected?: ((reason: unknown) => QueryResult | PromiseLike<QueryResult>) | null) =>
      (lastOp === "insert" ? awaitedThenable : selectThenable).catch(onrejected),
    finally: (onfinally?: (() => void) | null) =>
      (lastOp === "insert" ? awaitedThenable : selectThenable).finally(onfinally),
  };

  return builder;
}

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

// ── notifyUsers ────────────────────────────────────────

describe("notifyUsers", () => {
  it("dedupes ids and reads preferences with a single in-query", async () => {
    const prefsBuilder = makeTableMock({
      data: [
        { user_id: USER_A, types: ["event_created"] },
        { user_id: USER_B, types: [] },
      ],
    });
    const insertBuilder = makeTableMock();
    mockFrom.mockReturnValueOnce(prefsBuilder).mockReturnValueOnce(insertBuilder);

    await notifyUsers({
      userIds: [USER_A, USER_A, USER_B],
      type: "event_created",
      title: "Nuevo evento: Ensayo",
      link: "/events/e1",
    });

    expect(prefsBuilder.in).toHaveBeenCalledWith("user_id", [USER_A, USER_B]);
    expect(insertBuilder.insert).toHaveBeenCalledTimes(1);
    const payload = insertBuilder.insert.mock.calls[0]![0] as Array<{
      user_id: string;
      title: string;
      message: string | null;
      link: string | null;
      type: string;
    }>;
    expect(payload).toEqual([
      {
        user_id: USER_A,
        title: "Nuevo evento: Ensayo",
        message: null,
        link: "/events/e1",
        type: "event_created",
      },
      {
        user_id: USER_B,
        title: "Nuevo evento: Ensayo",
        message: null,
        link: "/events/e1",
        type: "event_created",
      },
    ]);
  });

  it("treats a missing preference row as 'receive everything'", async () => {
    const prefsBuilder = makeTableMock({ data: [] }); // no rows for any user
    const insertBuilder = makeTableMock();
    mockFrom.mockReturnValueOnce(prefsBuilder).mockReturnValueOnce(insertBuilder);

    await notifyUsers({ userIds: [USER_A], type: "news_created", title: "Nueva noticia" });

    expect(insertBuilder.insert).toHaveBeenCalledTimes(1);
    const payload = insertBuilder.insert.mock.calls[0]![0] as Array<{
      user_id: string;
      title: string;
      message: string | null;
      link: string | null;
      type: string;
    }>;
    expect(payload).toEqual([
      {
        user_id: USER_A,
        title: "Nueva noticia",
        message: null,
        link: null,
        type: "news_created",
      },
    ]);
  });

  it("treats an empty types array ('{}') as 'receive everything'", async () => {
    const prefsBuilder = makeTableMock({ data: [{ user_id: USER_A, types: [] }] });
    const insertBuilder = makeTableMock();
    mockFrom.mockReturnValueOnce(prefsBuilder).mockReturnValueOnce(insertBuilder);

    await notifyUsers({ userIds: [USER_A], type: "voting_created", title: "Nueva votación" });

    expect(insertBuilder.insert).toHaveBeenCalledTimes(1);
  });

  it("skips users whose preferences opt out of the type", async () => {
    const prefsBuilder = makeTableMock({
      data: [
        { user_id: USER_A, types: ["shift_assigned"] },
        { user_id: USER_B, types: ["event_created", "news_created"] },
      ],
    });
    const insertBuilder = makeTableMock();
    mockFrom.mockReturnValueOnce(prefsBuilder).mockReturnValueOnce(insertBuilder);

    await notifyUsers({ userIds: [USER_A, USER_B], type: "news_created", title: "Nueva noticia" });

    expect(insertBuilder.insert).toHaveBeenCalledTimes(1);
    const payload = insertBuilder.insert.mock.calls[0]![0] as Array<{ user_id: string }>;
    expect(payload).toHaveLength(1);
    expect(payload[0]?.user_id).toBe(USER_B);
  });

  it("performs a single bulk insert for all recipients", async () => {
    const prefsBuilder = makeTableMock({ data: [] });
    const insertBuilder = makeTableMock();
    mockFrom.mockReturnValueOnce(prefsBuilder).mockReturnValueOnce(insertBuilder);

    await notifyUsers({
      userIds: [USER_A, USER_B, USER_C],
      type: "profile_approved",
      title: "¡Tu cuenta ha sido aprobada!",
    });

    expect(insertBuilder.insert).toHaveBeenCalledTimes(1);
    const payload = insertBuilder.insert.mock.calls[0]![0] as Array<{ user_id: string }>;
    expect(payload).toHaveLength(3);
  });

  it("does nothing when no recipient remains after filtering", async () => {
    const prefsBuilder = makeTableMock({
      data: [{ user_id: USER_A, types: ["event_created"] }],
    });
    mockFrom.mockReturnValueOnce(prefsBuilder);

    await notifyUsers({ userIds: [USER_A], type: "news_created", title: "Nueva noticia" });

    expect(mockFrom).toHaveBeenCalledTimes(1); // no insert call
  });

  it("returns immediately when there are no ids", async () => {
    await notifyUsers({ userIds: [], type: "event_created", title: "x" });

    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("logs and swallows a preferences query error (no re-throw)", async () => {
    mockFrom.mockReturnValueOnce(makeTableMock({ error: new Error("prefs exploded") }));

    await expect(
      notifyUsers({ userIds: [USER_A], type: "event_created", title: "x" }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("logs and swallows an insert error (no re-throw)", async () => {
    mockFrom
      .mockReturnValueOnce(makeTableMock({ data: [] }))
      .mockReturnValueOnce(makeTableMock({ error: new Error("insert exploded") }));

    await expect(
      notifyUsers({ userIds: [USER_A], type: "event_created", title: "x" }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("swallows unexpected client errors without crashing the caller", async () => {
    mockFrom.mockImplementation(() => {
      throw new Error("connection refused");
    });

    await expect(
      notifyUsers({ userIds: [USER_A], type: "event_created", title: "x" }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});

// ── getAllActiveMemberIds ──────────────────────────────

describe("getAllActiveMemberIds", () => {
  it("returns the ids of active members", async () => {
    mockFrom.mockReturnValueOnce(makeTableMock({ data: [{ id: USER_A }, { id: USER_B }] }));

    const ids = await getAllActiveMemberIds();

    expect(ids).toEqual([USER_A, USER_B]);
    expect(mockFrom).toHaveBeenCalledWith("profiles");
    expect(createAdminClient).toHaveBeenCalled();
  });

  it("queries profiles filtered by status = active", async () => {
    const builder = makeTableMock({ data: [{ id: USER_A }] });
    mockFrom.mockReturnValueOnce(builder);

    const ids = await getAllActiveMemberIds();

    expect(ids).toEqual([USER_A]);
    expect(builder.select).toHaveBeenCalledWith("id");
    expect(builder.eq).toHaveBeenCalledWith("status", "active");
  });

  it("returns [] (no throw) when the query fails", async () => {
    mockFrom.mockReturnValueOnce(makeTableMock({ error: new Error("boom") }));

    expect(await getAllActiveMemberIds()).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });

  it("returns [] (no throw) when the client itself throws", async () => {
    mockFrom.mockImplementation(() => {
      throw new Error("boom");
    });

    expect(await getAllActiveMemberIds()).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });
});

// ── resolveEventRecipients ─────────────────────────────

describe("resolveEventRecipients", () => {
  it("resolves 'all' to every active member", async () => {
    mockFrom.mockReturnValueOnce(makeTableMock({ data: [{ id: USER_A }, { id: USER_B }] }));

    const ids = await resolveEventRecipients({
      audience_type: "all",
      audience_workgroup: null,
      audience_member_type: null,
      audience_user_ids: [],
    });

    expect(ids).toEqual([USER_A, USER_B]);
    expect(mockFrom).toHaveBeenCalledWith("profiles");
  });

  it("resolves 'workgroup' to the profiles of that group", async () => {
    const builder = makeTableMock({ data: [{ id: USER_A }] });
    mockFrom.mockReturnValueOnce(builder);

    const ids = await resolveEventRecipients({
      audience_type: "workgroup",
      audience_workgroup: "barra",
      audience_member_type: null,
      audience_user_ids: [],
    });

    expect(ids).toEqual([USER_A]);
    expect(builder.eq).toHaveBeenCalledWith("workgroup", "barra");
  });

  it("fails closed ([]) for an invalid workgroup value", async () => {
    const ids = await resolveEventRecipients({
      audience_type: "workgroup",
      audience_workgroup: "no-existe",
      audience_member_type: null,
      audience_user_ids: [],
    });

    expect(ids).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("resolves 'member_type' to the profiles of that component type", async () => {
    const builder = makeTableMock({ data: [{ id: USER_B }] });
    mockFrom.mockReturnValueOnce(builder);

    const ids = await resolveEventRecipients({
      audience_type: "member_type",
      audience_workgroup: null,
      audience_member_type: "music",
      audience_user_ids: [],
    });

    expect(ids).toEqual([USER_B]);
    expect(builder.eq).toHaveBeenCalledWith("component_type", "music");
  });

  it("fails closed ([]) for an invalid member type value", async () => {
    const ids = await resolveEventRecipients({
      audience_type: "member_type",
      audience_workgroup: null,
      audience_member_type: "no-existe",
      audience_user_ids: [],
    });

    expect(ids).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("resolves 'specific_users' to the listed ids, deduped", async () => {
    const ids = await resolveEventRecipients({
      audience_type: "specific_users",
      audience_workgroup: null,
      audience_member_type: null,
      audience_user_ids: [USER_A, USER_B, USER_A],
    });

    expect(ids).toEqual([USER_A, USER_B]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("fails closed with [] for unknown audience types", async () => {
    const ids = await resolveEventRecipients({
      audience_type: "bogus" as never,
      audience_workgroup: null,
      audience_member_type: null,
      audience_user_ids: [USER_A],
    });

    expect(ids).toEqual([]);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns [] (no throw) when the query fails", async () => {
    mockFrom.mockReturnValueOnce(makeTableMock({ error: new Error("boom") }));

    expect(
      await resolveEventRecipients({
        audience_type: "workgroup",
        audience_workgroup: "barra",
        audience_member_type: null,
        audience_user_ids: [],
      }),
    ).toEqual([]);
    expect(errorSpy).toHaveBeenCalled();
  });
});
