import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by vitest) ──────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { saveListOrdering } from "@/lib/ordering/mutations";
import type { AuthenticatedProfile } from "@/types/auth";

const mockFrom = vi.fn();

const USER_A = "323e4567-e89b-12d3-a456-426614174000";
const USER_B = "423e4567-e89b-12d3-a456-426614174000";

// ── Chain-builder stub (notifications-mutations test pattern) ──

interface QueryResult {
  data?: unknown[] | null;
  error?: Error | null;
}

function makeTableMock(
  selectResult: QueryResult = { data: null, error: null },
  awaitedResult: QueryResult = selectResult,
) {
  const resolveSingle = () =>
    Promise.resolve(
      Array.isArray(selectResult.data)
        ? { data: selectResult.data[0] ?? null, error: selectResult.error ?? null }
        : selectResult,
    );

  const selectThenable = Promise.resolve(selectResult);
  const awaitedThenable = Promise.resolve(awaitedResult);

  let lastOp: "select" | "insert" | "upsert" | "update" = "select";

  const builder = {
    select: vi.fn(() => {
      lastOp = "select";
      return builder;
    }),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    insert: vi.fn(() => {
      lastOp = "insert";
      return builder;
    }),
    upsert: vi.fn(() => {
      lastOp = "upsert";
      return builder;
    }),
    update: vi.fn(() => {
      lastOp = "update";
      return builder;
    }),
    maybeSingle: vi.fn(resolveSingle),
    single: vi.fn(resolveSingle),
    then: (
      onfulfilled?: ((value: QueryResult) => QueryResult | PromiseLike<QueryResult>) | null,
      onrejected?: ((reason: unknown) => QueryResult | PromiseLike<QueryResult>) | null,
    ) =>
      (lastOp === "insert" || lastOp === "upsert"
        ? awaitedThenable
        : selectThenable
      ).then(onfulfilled, onrejected),
    catch: (onrejected?: ((reason: unknown) => QueryResult | PromiseLike<QueryResult>) | null) =>
      (lastOp === "insert" || lastOp === "upsert"
        ? awaitedThenable
        : selectThenable
      ).catch(onrejected),
    finally: (onfinally?: (() => void) | null) =>
      (lastOp === "insert" || lastOp === "upsert"
        ? awaitedThenable
        : selectThenable
      ).finally(onfinally),
  };

  return builder;
}

function actor(role: AuthenticatedProfile["role"] = "member"): AuthenticatedProfile {
  return {
    id: USER_A,
    firstName: "Ada",
    lastName: "Lovelace",
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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue({
    from: mockFrom,
  } as unknown as ReturnType<typeof createClient>);
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor());
});

describe("saveListOrdering", () => {
  it("upserts the merged document keyed by the actor's own id", async () => {
    // No existing row → merge starts from {}.
    const builder = makeTableMock({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    const result = await saveListOrdering("members", "name", "desc");

    expect(result).toEqual({ success: true, id: USER_A });
    expect(builder.eq).toHaveBeenCalledWith("user_id", USER_A);
    expect(builder.upsert).toHaveBeenCalledWith(
      {
        user_id: USER_A,
        list_ordering: { members: { sortBy: "name", direction: "desc" } },
      },
      { onConflict: "user_id" },
    );
  });

  it("preserves the other lists' saved sorts when merging", async () => {
    const builder = makeTableMock({
      data: [
        {
          list_ordering: {
            members: { sortBy: "created_at", direction: "desc" },
            events: { sortBy: "title", direction: "asc" },
          },
        },
      ],
      error: null,
    });
    mockFrom.mockReturnValue(builder);

    await saveListOrdering("instruments", "category", "asc");

    expect(builder.upsert).toHaveBeenCalledWith(
      {
        user_id: USER_A,
        list_ordering: {
          members: { sortBy: "created_at", direction: "desc" },
          events: { sortBy: "title", direction: "asc" },
          instruments: { sortBy: "category", direction: "asc" },
        },
      },
      { onConflict: "user_id" },
    );
  });

  it("overwrites only the target list inside the document", async () => {
    const builder = makeTableMock({
      data: [{ list_ordering: { members: { sortBy: "name", direction: "asc" } } }],
      error: null,
    });
    mockFrom.mockReturnValue(builder);

    await saveListOrdering("members", "workgroup", "desc");

    expect(builder.upsert).toHaveBeenCalledWith(
      {
        user_id: USER_A,
        list_ordering: { members: { sortBy: "workgroup", direction: "desc" } },
      },
      { onConflict: "user_id" },
    );
  });

  it("rejects invalid input without touching the database", async () => {
    mockFrom.mockReturnValue(makeTableMock());

    const invalidDirection = await saveListOrdering("members", "name", "sideways" as never);
    expect(invalidDirection.success).toBe(false);
    expect(invalidDirection.error).toContain("Dirección de ordenación no válida.");

    const unknownList = await saveListOrdering("profile" as never, "name", "asc");
    expect(unknownList.success).toBe(false);
    expect(unknownList.error).toContain("Listado no válido.");

    const emptySortBy = await saveListOrdering("events", "", "asc");
    expect(emptySortBy.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects a sort field that does not belong to the list (cross-validation)", async () => {
    mockFrom.mockReturnValue(makeTableMock());

    const result = await saveListOrdering("members", "assignee", "asc");

    expect(result.success).toBe(false);
    expect(result.error).toContain('listado "members"');
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("accepts a cross-list-valid field on its own list (instruments + assignee)", async () => {
    const builder = makeTableMock({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    const result = await saveListOrdering("instruments", "assignee", "asc");

    expect(result.success).toBe(true);
  });

  it("merges from {} when the actor has no preferences row yet", async () => {
    const builder = makeTableMock({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    const result = await saveListOrdering("events", "event_date", "asc");

    expect(result.success).toBe(true);
    expect(builder.upsert).toHaveBeenCalledWith(
      {
        user_id: USER_A,
        list_ordering: { events: { sortBy: "event_date", direction: "asc" } },
      },
      { onConflict: "user_id" },
    );
  });

  it("recovers from a corrupted stored jsonb without throwing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const builder = makeTableMock({ data: [{ list_ordering: "corrupted-not-json-shape" }], error: null });
    mockFrom.mockReturnValue(builder);

    const result = await saveListOrdering("members", "name", "asc");

    expect(warn).toHaveBeenCalled();
    expect(result).toEqual({ success: true, id: USER_A });
    expect(builder.upsert).toHaveBeenCalledWith(
      {
        user_id: USER_A,
        list_ordering: { members: { sortBy: "name", direction: "asc" } },
      },
      { onConflict: "user_id" },
    );
  });

  it("returns the raw error message when the upsert fails", async () => {
    const builder = makeTableMock({ data: null, error: new Error("upsert failed") });
    mockFrom.mockReturnValue(builder);

    const result = await saveListOrdering("members", "name", "asc");

    expect(result).toEqual({ success: false, error: "upsert failed" });
  });

  it("returns the read error when the own-row SELECT fails", async () => {
    const builder = makeTableMock({
      data: null,
      error: new Error("read failed"),
    });
    mockFrom.mockReturnValue(builder);

    const result = await saveListOrdering("members", "name", "asc");

    expect(result.success).toBe(false);
    expect(result.error).toBe("read failed");
    expect(builder.upsert).not.toHaveBeenCalled();
  });

  it("propagates when there is no authenticated actor", async () => {
    vi.mocked(requireAuthenticatedProfile).mockRejectedValue(
      new Error("Se requiere autenticación."),
    );
    mockFrom.mockReturnValue(makeTableMock());

    await expect(saveListOrdering("members", "name", "asc")).rejects.toThrow(
      "Se requiere autenticación.",
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("double scope: user_id is ALWAYS the actor's id, never client input", async () => {
    // The API does not even accept a userId argument; assert the persisted
    // row is bound to the session actor and scoped by .eq(user_id).
    const builder = makeTableMock({ data: null, error: null });
    mockFrom.mockReturnValue(builder);
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(
      actor(),
    );

    await saveListOrdering("members", "name", "asc");

    expect(builder.upsert).toHaveBeenCalledTimes(1);
    const [payload] = (builder.upsert.mock.calls[0] ?? []) as unknown as [
      { user_id: string },
      object,
    ];
    expect(payload.user_id).toBe(USER_A);
    expect(payload.user_id).not.toBe(USER_B);
    expect(builder.eq).toHaveBeenCalledWith("user_id", USER_A);
  });
});
