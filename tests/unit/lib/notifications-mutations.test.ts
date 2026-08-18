import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by vitest) ──────────────────────────

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import {
  markAsRead,
  markAllAsRead,
  updateNotificationPreferences,
  createNotification,
} from "@/lib/notifications/mutations";
import type { AuthenticatedProfile } from "@/types/auth";

const mockFrom = vi.fn();
const mockAdminFrom = vi.fn();

const NOTIFICATION_ID = "123e4567-e89b-12d3-a456-426614174001";
const USER_A = "323e4567-e89b-12d3-a456-426614174000";
const USER_B = "423e4567-e89b-12d3-a456-426614174000";

// ── Chain-builder stub (votings-mutations test pattern) ──

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

  let lastOp: "select" | "insert" | "upsert" = "select";

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
      lastOp = "select";
      return builder;
    }),
    maybeSingle: vi.fn(resolveSingle),
    single: vi.fn(resolveSingle),
    then: (
      onfulfilled?: ((value: QueryResult) => QueryResult | PromiseLike<QueryResult>) | null,
      onrejected?: ((reason: unknown) => QueryResult | PromiseLike<QueryResult>) | null,
    ) =>
      (lastOp === "insert" || lastOp === "upsert" ? awaitedThenable : selectThenable).then(
        onfulfilled,
        onrejected,
      ),
    catch: (onrejected?: ((reason: unknown) => QueryResult | PromiseLike<QueryResult>) | null) =>
      (lastOp === "insert" || lastOp === "upsert" ? awaitedThenable : selectThenable).catch(
        onrejected,
      ),
    finally: (onfinally?: (() => void) | null) =>
      (lastOp === "insert" || lastOp === "upsert" ? awaitedThenable : selectThenable).finally(
        onfinally,
      ),
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
  vi.mocked(createAdminClient).mockReturnValue({
    from: mockAdminFrom,
  } as unknown as ReturnType<typeof createAdminClient>);
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor());
});

// ── markAsRead ─────────────────────────────────────────

describe("markAsRead", () => {
  it("updates only the actor's own notification (double scoping)", async () => {
    const builder = makeTableMock({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    const result = await markAsRead(NOTIFICATION_ID);

    expect(result).toEqual({ success: true });
    expect(builder.update).toHaveBeenCalledWith({ is_read: true });
    expect(builder.eq).toHaveBeenCalledWith("id", NOTIFICATION_ID);
    expect(builder.eq).toHaveBeenCalledWith("user_id", USER_A);
  });

  it("returns the raw error message when the update fails", async () => {
    const builder = makeTableMock({ data: null, error: new Error("update failed") });
    mockFrom.mockReturnValue(builder);

    const result = await markAsRead(NOTIFICATION_ID);

    expect(result.success).toBe(false);
    expect(result.error).toBe("update failed");
  });

  it("throws when there is no authenticated actor", async () => {
    vi.mocked(requireAuthenticatedProfile).mockRejectedValue(
      new Error("Se requiere autenticación."),
    );
    mockFrom.mockReturnValue(makeTableMock());

    await expect(markAsRead(NOTIFICATION_ID)).rejects.toThrow("Se requiere autenticación.");
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ── markAllAsRead ──────────────────────────────────────

describe("markAllAsRead", () => {
  it("updates every unread notification scoped to the actor", async () => {
    const builder = makeTableMock({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    const result = await markAllAsRead();

    expect(result).toEqual({ success: true });
    expect(builder.update).toHaveBeenCalledWith({ is_read: true });
    expect(builder.eq).toHaveBeenCalledWith("user_id", USER_A);
    expect(builder.eq).toHaveBeenCalledWith("is_read", false);
  });

  it("returns the raw error message when the update fails", async () => {
    const builder = makeTableMock({ data: null, error: new Error("update failed") });
    mockFrom.mockReturnValue(builder);

    const result = await markAllAsRead();

    expect(result.success).toBe(false);
    expect(result.error).toBe("update failed");
  });
});

// ── updateNotificationPreferences ──────────────────────

describe("updateNotificationPreferences", () => {
  it("upserts the actor's preferences with an on-conflict on user_id", async () => {
    const builder = makeTableMock({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    const result = await updateNotificationPreferences(["event_created", "shift_assigned"]);

    expect(result).toEqual({ success: true });
    expect(builder.upsert).toHaveBeenCalledWith(
      { user_id: USER_A, types: ["event_created", "shift_assigned"] },
      { onConflict: "user_id" },
    );
  });

  it("dedupes the types before persisting", async () => {
    const builder = makeTableMock({ data: null, error: null });
    mockFrom.mockReturnValue(builder);

    await updateNotificationPreferences(["event_created", "event_created", "shift_assigned"]);

    expect(builder.upsert).toHaveBeenCalledWith(
      { user_id: USER_A, types: ["event_created", "shift_assigned"] },
      { onConflict: "user_id" },
    );
  });

  it("rejects invalid types without touching the database", async () => {
    mockFrom.mockReturnValue(makeTableMock());

    const result = await updateNotificationPreferences(["bogus" as never]);

    expect(result.success).toBe(false);
    expect(result.error).toContain("Tipo de notificación no válido.");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns the raw error message when the upsert fails", async () => {
    const builder = makeTableMock({ data: null, error: new Error("upsert failed") });
    mockFrom.mockReturnValue(builder);

    const result = await updateNotificationPreferences([]);

    expect(result.success).toBe(false);
    expect(result.error).toBe("upsert failed");
  });
});

// ── createNotification ─────────────────────────────────

describe("createNotification", () => {
  const validInput = {
    user_id: USER_B,
    title: "Nuevo evento: Ensayo general",
    message: "Sábado 15:00",
    type: "event_created",
    link: "/events/e1",
  } as const;

  it("inserts the row through the privileged admin client and returns the id", async () => {
    const builder = makeTableMock({ data: [{ id: "notif-1" }] });
    mockAdminFrom.mockReturnValue(builder);

    const result = await createNotification(validInput);

    expect(result).toEqual({ success: true, id: "notif-1" });
    expect(createAdminClient).toHaveBeenCalled();
    expect(builder.insert).toHaveBeenCalledWith({
      user_id: USER_B,
      title: "Nuevo evento: Ensayo general",
      message: "Sábado 15:00",
      type: "event_created",
      link: "/events/e1",
    });
  });

  it("rejects invalid input without touching the database", async () => {
    mockAdminFrom.mockReturnValue(makeTableMock());

    const result = await createNotification({ ...validInput, user_id: "not-a-uuid" });

    expect(result.success).toBe(false);
    expect(mockAdminFrom).not.toHaveBeenCalled();
  });

  it("returns the raw error message when the insert fails", async () => {
    const builder = makeTableMock({ data: null, error: new Error("insert failed") });
    mockAdminFrom.mockReturnValue(builder);

    const result = await createNotification(validInput);

    expect(result.success).toBe(false);
    expect(result.error).toBe("insert failed");
  });
});
