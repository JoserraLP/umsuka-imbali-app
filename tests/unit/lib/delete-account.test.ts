import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (hoisted by vitest) ──────────────────────────

const mockAdminFrom = vi.fn();
const mockDeleteUser = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({
    from: mockAdminFrom,
    auth: { admin: { deleteUser: mockDeleteUser } },
  })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

vi.mock("@/lib/admin/mutations", () => ({
  logAuditAction: vi.fn(),
}));

import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { logAuditAction } from "@/lib/admin/mutations";
import { deleteAccountPermanently } from "@/lib/auth/delete-account";
import type { AuthenticatedProfile } from "@/types/auth";

const ACTOR_ID = "123e4567-e89b-12d3-a456-426614174000";
const TARGET_USER = "323e4567-e89b-12d3-a456-426614174000";

// ── Admin client table stub ─────────────────────────────

interface QueryResult {
  data?: unknown;
  error?: Error | { message: string } | null;
}

function makeBuilder(result: QueryResult) {
  const thenValue = Promise.resolve({
    data: result.data ?? null,
    error: result.error ?? null,
  });

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    maybeSingle: vi.fn(() =>
      Promise.resolve({ data: result.data ?? null, error: result.error ?? null }),
    ),
    then: thenValue.then.bind(thenValue),
    catch: thenValue.catch.bind(thenValue),
    finally: thenValue.finally.bind(thenValue),
  };
  return builder;
}

type Builder = ReturnType<typeof makeBuilder>;

let tableQueues: Record<string, QueryResult[]>;
let calls: Array<{ table: string; builder: Builder }>;

/** Scripts one result per query call on each table (FIFO). */
function scriptDb(results: Record<string, QueryResult | QueryResult[]>) {
  tableQueues = {};
  for (const [table, value] of Object.entries(results)) {
    tableQueues[table] = Array.isArray(value) ? [...value] : [value];
  }
  calls = [];
}

mockAdminFrom.mockImplementation((table: string) => {
  const queue = tableQueues?.[table];
  if (!queue || queue.length === 0) {
    throw new Error(`Unexpected query on table "${table}"`);
  }
  const builder = makeBuilder(queue.shift()!);
  calls.push({ table, builder });
  return builder;
});

function tablesCalled(): string[] {
  return calls.map((c) => c.table);
}

function profilesUpdateBuilders(): Builder[] {
  return calls.filter((c) => c.table === "profiles").map((c) => c.builder);
}

// ── Fixtures ───────────────────────────────────────────

const TARGET_PROFILE = {
  id: TARGET_USER,
  first_name: "Ada",
  last_name: "Lovelace",
  role: "admin",
};

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

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  tableQueues = {};
  calls = [];
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(makeActor());
  mockDeleteUser.mockResolvedValue({ data: { id: TARGET_USER }, error: null });
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

// ── deleteAccountPermanently ────────────────────────────

describe("deleteAccountPermanently", () => {
  it("soft-deletes the profile, purges tokens, deletes the auth user and audits user.deleted once", async () => {
    scriptDb({
      profiles: [{ data: TARGET_PROFILE }, {}],
      password_reset_tokens: [{}],
    });

    const result = await deleteAccountPermanently(TARGET_USER);

    expect(result).toEqual({ success: true });

    // soft delete (admin client, bypasses RLS)
    const [profileRead, profileUpdate] = profilesUpdateBuilders();
    expect(profileRead?.maybeSingle).toHaveBeenCalled();
    expect(profileUpdate?.update).toHaveBeenCalledWith({ deleted_at: expect.any(String) });
    expect(profileUpdate?.eq).toHaveBeenCalledWith("id", TARGET_USER);

    // token purge
    const tokens = calls.find((c) => c.table === "password_reset_tokens")?.builder;
    expect(tokens?.delete).toHaveBeenCalled();
    expect(tokens?.eq).toHaveBeenCalledWith("created_by", TARGET_USER);

    // physical auth deletion
    expect(mockDeleteUser).toHaveBeenCalledWith(TARGET_USER);

    // audit exactly once
    expect(logAuditAction).toHaveBeenCalledTimes(1);
    expect(logAuditAction).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      action: "user.deleted",
      entityType: "auth.user",
      entityId: TARGET_USER,
      details: { firstName: "Ada", lastName: "Lovelace", role: "admin" },
    });
  });

  it("rejects non-super admins without touching the database", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(makeActor("admin"));
    scriptDb({ profiles: [{ data: TARGET_PROFILE }, {}] });

    const result = await deleteAccountPermanently(TARGET_USER);

    expect(result.success).toBe(false);
    expect(result.error).toContain("super admin");
    expect(mockAdminFrom).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(logAuditAction).not.toHaveBeenCalled();
  });

  it("rejects self-deletion before touching the database", async () => {
    scriptDb({ profiles: [{ data: TARGET_PROFILE }, {}] });

    const result = await deleteAccountPermanently(ACTOR_ID);

    expect(result.success).toBe(false);
    expect(result.error).toContain("tu propia cuenta");
    expect(mockAdminFrom).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(logAuditAction).not.toHaveBeenCalled();
  });

  it("rejects a target that does not exist", async () => {
    scriptDb({ profiles: [{ data: null }] });

    const result = await deleteAccountPermanently(TARGET_USER);

    expect(result.success).toBe(false);
    expect(result.error).toBe("El usuario no existe.");
    expect(tablesCalled()).toEqual(["profiles"]);
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(logAuditAction).not.toHaveBeenCalled();
  });

  it("returns the soft-delete error without deleting anything further", async () => {
    scriptDb({
      profiles: [{ data: TARGET_PROFILE }, { error: { message: "soft delete failed" } }],
    });

    const result = await deleteAccountPermanently(TARGET_USER);

    expect(result.success).toBe(false);
    expect(result.error).toBe("soft delete failed");
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(logAuditAction).not.toHaveBeenCalled();
  });

  it("keeps the profile soft-deleted when the auth deletion fails (no audit)", async () => {
    scriptDb({
      profiles: [{ data: TARGET_PROFILE }, {}],
      password_reset_tokens: [{}],
    });
    mockDeleteUser.mockResolvedValue({ data: null, error: { message: "delete failed" } });

    const result = await deleteAccountPermanently(TARGET_USER);

    expect(result.success).toBe(false);
    expect(result.error).toBe("delete failed");
    // The safeguard: the profile update happened BEFORE the auth delete.
    expect(profilesUpdateBuilders()[1]?.update).toHaveBeenCalledWith({
      deleted_at: expect.any(String),
    });
    expect(logAuditAction).not.toHaveBeenCalled();
  });

  it("still reports success when the audit write fails (best-effort)", async () => {
    vi.mocked(logAuditAction).mockRejectedValue(new Error("audit boom"));
    scriptDb({
      profiles: [{ data: TARGET_PROFILE }, {}],
      password_reset_tokens: [{}],
    });

    const result = await deleteAccountPermanently(TARGET_USER);

    expect(result).toEqual({ success: true });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("rejects an invalid user id without touching the database", async () => {
    scriptDb({ profiles: [{ data: TARGET_PROFILE }] });

    const result = await deleteAccountPermanently("not-a-uuid");

    expect(result.success).toBe(false);
    expect(result.error).toContain("id de usuario");
    expect(mockAdminFrom).not.toHaveBeenCalled();
    expect(mockDeleteUser).not.toHaveBeenCalled();
    expect(logAuditAction).not.toHaveBeenCalled();
  });
});
