import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by vitest) ──────────────────────────

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

import {
  getMyNotifications,
  getUnreadCount,
  getMyNotificationPreferences,
} from "@/lib/notifications/queries";

const USER_ID = "323e4567-e89b-12d3-a456-426614174000";

// ── Chain-builder stub ─────────────────────────────────

interface QueryResult {
  data?: unknown[] | null;
  count?: number | null;
  error?: { message: string } | null;
}

/**
 * Chainable table stub: awaited chains resolve `selectResult`; single/
 * maybeSingle resolve the first element of `selectResult.data`. `.count`
 * feeds the head-only count queries.
 */
function makeTableMock(result: QueryResult = {}) {
  const thenValue = {
    data: Array.isArray(result.data) ? result.data : (result.data ?? null),
    count: result.count ?? null,
    error: result.error ?? null,
  };
  const thenable = Promise.resolve(thenValue);

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    maybeSingle: vi.fn(() =>
      Promise.resolve({
        data: Array.isArray(result.data) ? (result.data[0] ?? null) : (result.data ?? null),
        error: result.error ?? null,
      }),
    ),
    then: thenable.then.bind(thenable),
    catch: thenable.catch.bind(thenable),
    finally: thenable.finally.bind(thenable),
  };
  return builder;
}

function setupFrom(result: QueryResult = {}) {
  const builder = makeTableMock(result);
  mockFrom.mockReturnValue(builder);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── getMyNotifications ─────────────────────────────────

describe("getMyNotifications", () => {
  const rows = [
    {
      id: "n1",
      user_id: USER_ID,
      title: "Nuevo evento: Ensayo",
      message: "Sábado 15:00",
      type: "event_created",
      is_read: false,
      link: "/events/e1",
      created_at: "2026-08-17T10:00:00.000Z",
    },
    {
      id: "n2",
      user_id: USER_ID,
      title: "Turno asignado: Barra",
      message: null,
      type: "shift_assigned",
      is_read: true,
      link: null,
      created_at: "2026-08-16T10:00:00.000Z",
    },
  ];

  it("queries the user's rows newest first with the requested pagination window", async () => {
    const builder = setupFrom({ data: rows });

    const items = await getMyNotifications(USER_ID, { limit: 50, offset: 0 });

    expect(items).toHaveLength(2);
    expect(builder.select).toHaveBeenCalledWith(
      "id, user_id, title, message, type, is_read, link, created_at",
    );
    expect(builder.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(builder.range).toHaveBeenCalledWith(0, 49);
  });

  it("applies the limit/offset mapping to the range window", async () => {
    const builder = setupFrom({ data: [] });

    await getMyNotifications(USER_ID, { limit: 20, offset: 40 });

    expect(builder.range).toHaveBeenCalledWith(40, 59);
  });

  it("maps rows from snake_case to the camelCase UI shape", async () => {
    setupFrom({ data: rows });

    const items = await getMyNotifications(USER_ID);

    expect(items[0]).toEqual({
      id: "n1",
      userId: USER_ID,
      title: "Nuevo evento: Ensayo",
      message: "Sábado 15:00",
      type: "event_created",
      isRead: false,
      link: "/events/e1",
      createdAt: "2026-08-17T10:00:00.000Z",
    });
    expect(items[1]?.message).toBeNull();
    expect(items[1]?.isRead).toBe(true);
  });

  it("defaults to the 50-item window without options", async () => {
    const builder = setupFrom({ data: [] });

    await getMyNotifications(USER_ID);

    expect(builder.range).toHaveBeenCalledWith(0, 49);
  });

  it("throws a contextual Spanish error when the query fails", async () => {
    setupFrom({ error: { message: "relation does not exist" } });

    await expect(getMyNotifications(USER_ID)).rejects.toThrow(
      "Error al obtener notificaciones: relation does not exist",
    );
  });
});

// ── getUnreadCount ─────────────────────────────────────

describe("getUnreadCount", () => {
  it("performs a head-only exact count scoped to unread rows of the user", async () => {
    const builder = setupFrom({ count: 7 });

    const count = await getUnreadCount(USER_ID);

    expect(count).toBe(7);
    expect(builder.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(builder.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(builder.eq).toHaveBeenCalledWith("is_read", false);
  });

  it("falls back to 0 when the count is null", async () => {
    setupFrom({ count: null });

    expect(await getUnreadCount(USER_ID)).toBe(0);
  });

  it("falls back to 0 (without throwing) when the query fails", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    setupFrom({ error: { message: "boom" } });

    expect(await getUnreadCount(USER_ID)).toBe(0);
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

// ── getMyNotificationPreferences ───────────────────────

describe("getMyNotificationPreferences", () => {
  it("returns the mapped row when preferences exist", async () => {
    setupFrom({
      data: [{ user_id: USER_ID, types: ["event_created", "shift_assigned"] }],
    });

    const prefs = await getMyNotificationPreferences(USER_ID);

    expect(prefs).toEqual({ userId: USER_ID, types: ["event_created", "shift_assigned"] });
  });

  it("treats a missing row as { types: [] } (receive everything)", async () => {
    const builder = setupFrom({ data: [] });

    const prefs = await getMyNotificationPreferences(USER_ID);

    expect(prefs).toEqual({ userId: USER_ID, types: [] });
    expect(builder.maybeSingle).toHaveBeenCalled();
  });

  it("throws a contextual Spanish error when the query fails", async () => {
    setupFrom({ error: { message: "permission denied" } });

    await expect(getMyNotificationPreferences(USER_ID)).rejects.toThrow(
      "Error al obtener preferencias de notificación: permission denied",
    );
  });
});
