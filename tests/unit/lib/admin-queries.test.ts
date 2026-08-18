import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (hoisted by vitest) ──────────────────────────

const mockFrom = vi.fn();
const mockRpc = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ from: mockFrom, rpc: mockRpc })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

vi.mock("@/lib/profiles/queries", () => ({
  listProfiles: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { listProfiles } from "@/lib/profiles/queries";
import { listSettings, getSetting, listAuditLogs, listUsersOverview } from "@/lib/admin/queries";
import { AUDIT_PAGE_SIZE } from "@/lib/admin/schema";
import { AuthorizationError } from "@/lib/auth/permissions";
import type { AuthenticatedProfile } from "@/types/auth";
import type { ProfileListItem } from "@/lib/profiles/queries";

const ACTOR_ID = "123e4567-e89b-12d3-a456-426614174000";
const USER_A = "323e4567-e89b-12d3-a456-426614174000";
const USER_B = "423e4567-e89b-12d3-a456-426614174000";

interface DbResult {
  data?: unknown[] | null;
  count?: number | null;
  error?: { message: string } | null;
  singleData?: unknown;
  maybeSingleData?: unknown;
}

type ChainBuilder = ReturnType<typeof makeTableMock>;

function makeTableMock(result: DbResult = {}) {
  const thenValue = {
    data: Array.isArray(result.data) ? result.data : (result.data ?? null),
    count: result.count ?? null,
    error: result.error ?? null,
  };
  const thenable = Promise.resolve(thenValue);

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    maybeSingle: vi.fn(() =>
      Promise.resolve({
        data: result.maybeSingleData ?? null,
        error: result.error ?? null,
      }),
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

/**
 * Scripted `from(table)` mock: each table consumes its step list in
 * order (audit_logs is read twice per call: the head-only count and the
 * data page). Any unexpected table/step throws to surface drift.
 */
let tableSteps: Record<string, DbResult[]> = {};
let calls: Array<{ table: string; builder: ChainBuilder }> = [];

function scriptDb(steps: Record<string, DbResult[]>) {
  tableSteps = Object.fromEntries(
    Object.entries(steps).map(([table, list]) => [table, [...list]]),
  );
  calls = [];
}

mockFrom.mockImplementation((table: string) => {
  const step = tableSteps[table]?.shift();
  if (!step) {
    throw new Error(`Unexpected query on table "${table}"`);
  }
  const builder = makeTableMock(step);
  calls.push({ table, builder });
  return builder;
});

// ── Fixtures ───────────────────────────────────────────

function makeActor(role: AuthenticatedProfile["role"] = "super_admin"): AuthenticatedProfile {
  return {
    id: ACTOR_ID,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@umsuka.org",
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
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

function makeProfile(id: string, firstName: string, lastName: string): ProfileListItem {
  return {
    id,
    firstName,
    lastName,
    componentType: "member",
    workgroup: "ninguno",
    role: "member",
    isActive: true,
    status: "active",
    username: null,
    authMethod: "google",
    componentLeadFor: null,
    skills: [],
    joinedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

const AUDIT_ROWS = [
  {
    id: "log-1",
    user_id: ACTOR_ID,
    action: "user.role_changed",
    entity_type: "profile",
    entity_id: USER_A,
    details: { fromRole: "member", toRole: "admin" },
    created_at: "2026-08-18T10:00:00.000Z",
  },
  {
    id: "log-2",
    user_id: USER_B,
    action: "settings.updated",
    entity_type: "settings",
    entity_id: "app_name",
    details: null,
    created_at: "2026-08-17T10:00:00.000Z",
  },
];

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  scriptDb({});
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(makeActor());
  vi.mocked(createClient).mockReturnValue({
    from: mockFrom,
    rpc: mockRpc,
  } as unknown as ReturnType<typeof createClient>);
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

// ── listSettings ────────────────────────────────────────

describe("listSettings", () => {
  it("denies callers without settings.read", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(makeActor("member"));

    await expect(listSettings()).rejects.toThrow(AuthorizationError);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns the mapped settings ordered by key", async () => {
    scriptDb({
      settings: [
        {
          data: [
            { key: "instagram_url", value: "https://instagram.com/umsukaimbali", updated_by: null, updated_at: "2026-08-01T00:00:00.000Z" },
            { key: "app_name", value: "Umsuka Imbali", updated_by: ACTOR_ID, updated_at: "2026-08-18T10:00:00.000Z" },
          ],
        },
      ],
    });

    const items = await listSettings();

    expect(items).toEqual([
      { key: "instagram_url", value: "https://instagram.com/umsukaimbali", updatedBy: null, updatedAt: "2026-08-01T00:00:00.000Z" },
      { key: "app_name", value: "Umsuka Imbali", updatedBy: ACTOR_ID, updatedAt: "2026-08-18T10:00:00.000Z" },
    ]);
    expect(calls[0]?.builder.order).toHaveBeenCalledWith("key", { ascending: true });
  });

  it("returns [] when the table is empty", async () => {
    scriptDb({ settings: [{ data: [] }] });

    expect(await listSettings()).toEqual([]);
  });

  it("throws a contextual error on DB failure", async () => {
    scriptDb({ settings: [{ error: { message: "relation does not exist" } }] });

    await expect(listSettings()).rejects.toThrow(
      "Error al obtener la configuración: relation does not exist",
    );
  });
});

// ── getSetting ──────────────────────────────────────────

describe("getSetting", () => {
  it("returns null when the key has no row", async () => {
    scriptDb({ settings: [{ maybeSingleData: null }] });

    expect(await getSetting("app_name")).toBeNull();
  });

  it("returns the mapped row when it exists", async () => {
    scriptDb({
      settings: [
        {
          maybeSingleData: { key: "app_name", value: "Umsuka Imbali", updated_by: ACTOR_ID, updated_at: "2026-08-18T10:00:00.000Z" },
        },
      ],
    });

    const item = await getSetting("app_name");

    expect(item).toEqual({
      key: "app_name",
      value: "Umsuka Imbali",
      updatedBy: ACTOR_ID,
      updatedAt: "2026-08-18T10:00:00.000Z",
    });
    expect(calls[0]?.builder.eq).toHaveBeenCalledWith("key", "app_name");
  });

  it("throws on DB failure", async () => {
    scriptDb({ settings: [{ error: { message: "boom" } }] });

    await expect(getSetting("app_name")).rejects.toThrow("Error al obtener la configuración: boom");
  });
});

// ── listAuditLogs ───────────────────────────────────────

describe("listAuditLogs", () => {
  function auditResult(): DbResult {
    return { count: 2, data: AUDIT_ROWS };
  }

  it("denies callers without audit.read", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(makeActor("member"));

    await expect(listAuditLogs({ page: 1, offset: 0 })).rejects.toThrow(AuthorizationError);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("runs a head-only exact count plus the ordered data page", async () => {
    scriptDb({
      audit_logs: [auditResult(), auditResult()],
      profiles: [{ data: [] }],
    });

    const result = await listAuditLogs({ page: 1, offset: 0 });

    expect(result.total).toBe(2);
    expect(calls[0]?.builder.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(calls[1]?.builder.order).toHaveBeenCalledWith("created_at", { ascending: false });
    expect(calls[1]?.builder.range).toHaveBeenCalledWith(0, AUDIT_PAGE_SIZE - 1);
  });

  it("applies user/action/from/to filters to both queries", async () => {
    scriptDb({
      audit_logs: [auditResult(), auditResult()],
      profiles: [{ data: [] }],
    });

    await listAuditLogs({
      user: USER_A,
      action: "user.role_changed",
      from: "2026-08-01",
      to: "2026-08-18",
      toEndOfDay: "2026-08-18T23:59:59.999Z",
      page: 1,
      offset: 0,
    });

    for (const { builder } of calls.slice(0, 2)) {
      expect(builder.eq).toHaveBeenCalledWith("user_id", USER_A);
      expect(builder.eq).toHaveBeenCalledWith("action", "user.role_changed");
      expect(builder.gte).toHaveBeenCalledWith("created_at", "2026-08-01");
      expect(builder.lte).toHaveBeenCalledWith("created_at", "2026-08-18T23:59:59.999Z");
    }
  });

  it("paginates with the offset of the requested page", async () => {
    scriptDb({
      audit_logs: [auditResult(), auditResult()],
      profiles: [{ data: [] }],
    });

    await listAuditLogs({ page: 3, offset: 100 });

    expect(calls[1]?.builder.range).toHaveBeenCalledWith(100, 100 + AUDIT_PAGE_SIZE - 1);
  });

  it("reports hasMore when more rows exist beyond the fetched page", async () => {
    scriptDb({
      audit_logs: [{ count: 60, data: AUDIT_ROWS }, { count: 60, data: AUDIT_ROWS }],
      profiles: [{ data: [] }],
    });

    const result = await listAuditLogs({ page: 1, offset: 0 });

    expect(result.total).toBe(60);
    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true); // 0 + 2 < 60
  });

  it("reports hasMore false when the page reaches the total", async () => {
    scriptDb({
      audit_logs: [{ count: 2, data: AUDIT_ROWS }, { count: 2, data: AUDIT_ROWS }],
      profiles: [{ data: [] }],
    });

    const result = await listAuditLogs({ page: 1, offset: 0 });

    expect(result.hasMore).toBe(false);
  });

  it("resolves actor display names from profiles with a single .in() query", async () => {
    scriptDb({
      audit_logs: [auditResult(), auditResult()],
      profiles: [
        {
          data: [
            { id: ACTOR_ID, first_name: "Ada", last_name: "Lovelace" },
            { id: USER_B, first_name: "Grace", last_name: "Hopper" },
          ],
        },
      ],
    });

    const result = await listAuditLogs({ page: 1, offset: 0 });

    expect(result.items[0]?.actorName).toBe("Ada Lovelace");
    expect(result.items[1]?.actorName).toBe("Grace Hopper");
    expect(calls[2]?.builder.in).toHaveBeenCalledWith("id", [ACTOR_ID, USER_B]);
  });

  it("falls back to 'Usuario eliminado' for unknown or null actor ids", async () => {
    scriptDb({
      audit_logs: [auditResult(), auditResult()],
      profiles: [{ data: [{ id: ACTOR_ID, first_name: "Ada", last_name: "Lovelace" }] }],
    });

    const result = await listAuditLogs({ page: 1, offset: 0 });

    expect(result.items[0]?.actorName).toBe("Ada Lovelace");
    expect(result.items[1]?.actorName).toBe("Usuario eliminado");
  });

  it("maps the log rows to the camelCase UI shape", async () => {
    scriptDb({
      audit_logs: [auditResult(), auditResult()],
      profiles: [{ data: [] }],
    });

    const result = await listAuditLogs({ page: 1, offset: 0 });

    expect(result.items[0]).toMatchObject({
      id: "log-1",
      userId: ACTOR_ID,
      action: "user.role_changed",
      entityType: "profile",
      entityId: USER_A,
      details: { fromRole: "member", toRole: "admin" },
      createdAt: "2026-08-18T10:00:00.000Z",
    });
  });

  it("throws a contextual error when the data query fails", async () => {
    scriptDb({
      audit_logs: [{ count: 0, data: [] }, { error: { message: "permission denied" } }],
    });

    await expect(listAuditLogs({ page: 1, offset: 0 })).rejects.toThrow(
      "Error al obtener los registros de auditoría: permission denied",
    );
  });
});

// ── listUsersOverview ───────────────────────────────────

describe("listUsersOverview", () => {
  const profiles = [makeProfile(USER_A, "Ada", "Lovelace"), makeProfile(USER_B, "Grace", "Hopper")];

  it("denies callers without users.read", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(makeActor("member"));

    await expect(listUsersOverview()).rejects.toThrow(AuthorizationError);
    expect(listProfiles).not.toHaveBeenCalled();
  });

  it("combines listProfiles with the masked emails from the rpc", async () => {
    vi.mocked(listProfiles).mockResolvedValue(profiles);
    mockRpc.mockResolvedValue({
      data: [
        { id: USER_A, email: "ada@umsuka.org" },
        { id: USER_B, email: null }, // internal alias masked by the RPC
      ],
      error: null,
    });

    const rows = await listUsersOverview();

    expect(mockRpc).toHaveBeenCalledWith("get_user_emails", {
      p_user_ids: [USER_A, USER_B],
    });
    expect(rows[0]).toMatchObject({ id: USER_A, email: "ada@umsuka.org", firstName: "Ada" });
    expect(rows[1]).toMatchObject({ id: USER_B, email: null, firstName: "Grace" });
  });

  it("falls back to null emails when the rpc fails (non-admin callers)", async () => {
    vi.mocked(listProfiles).mockResolvedValue(profiles);
    mockRpc.mockResolvedValue({ data: null, error: { message: "forbidden" } });

    const rows = await listUsersOverview();

    expect(rows).toHaveLength(2);
    expect(rows[0]?.email).toBeNull();
    expect(rows[1]?.email).toBeNull();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("returns [] without calling the rpc when there are no profiles", async () => {
    vi.mocked(listProfiles).mockResolvedValue([]);

    expect(await listUsersOverview()).toEqual([]);
    expect(mockRpc).not.toHaveBeenCalled();
  });
});