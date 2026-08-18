import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mocks (hoisted by vitest) ──────────────────────────

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

vi.mock("@/lib/profiles/mutations", () => ({
  updateMemberRole: vi.fn(),
  setMemberActive: vi.fn(),
}));

vi.mock("@/lib/approvals/mutations", () => ({
  approveUser: vi.fn(),
  suspendUser: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import {
  updateMemberRole as profilesUpdateMemberRole,
  setMemberActive as profilesSetMemberActive,
} from "@/lib/profiles/mutations";
import {
  approveUser as approvalsApproveUser,
  suspendUser as approvalsSuspendUser,
} from "@/lib/approvals/mutations";
import {
  updateSetting,
  logAuditAction,
  updateUserRole,
  setUserActive,
  approveUser,
  suspendUser,
} from "@/lib/admin/mutations";
import type { AuthenticatedProfile } from "@/types/auth";

const ACTOR_ID = "123e4567-e89b-12d3-a456-426614174000";
const TARGET_USER = "323e4567-e89b-12d3-a456-426614174000";

// ── Table stub ─────────────────────────────────────────

interface QueryResult {
  data?: unknown[] | null;
  error?: Error | { message: string } | null;
}

function makeTableMock(result: QueryResult = {}) {
  const thenValue = {
    data: Array.isArray(result.data) ? result.data : (result.data ?? null),
    error: result.error ?? null,
  };
  const thenable = Promise.resolve(thenValue);

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    upsert: vi.fn(() => builder),
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

type ChainBuilder = ReturnType<typeof makeTableMock>;

let tableResults: Record<string, QueryResult>;
let calls: Array<{ table: string; builder: ChainBuilder }>;

function scriptDb(results: Record<string, QueryResult>) {
  tableResults = { ...results };
  calls = [];
}

mockFrom.mockImplementation((table: string) => {
  const result = tableResults[table];
  if (result === undefined) {
    throw new Error(`Unexpected query on table "${table}"`);
  }
  const builder = makeTableMock(result);
  calls.push({ table, builder });
  return builder;
});

function auditBuilders(): ChainBuilder[] {
  return calls.filter((c) => c.table === "audit_logs").map((c) => c.builder);
}

function settingsBuilders(): ChainBuilder[] {
  return calls.filter((c) => c.table === "settings").map((c) => c.builder);
}

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

let errorSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  scriptDb({});
  vi.mocked(createClient).mockReturnValue({
    from: mockFrom,
  } as unknown as ReturnType<typeof createClient>);
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(makeActor());
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  errorSpy.mockRestore();
});

// ── updateSetting ───────────────────────────────────────

describe("updateSetting", () => {
  it("upserts the setting with updated_by = actor id (on conflict key)", async () => {
    scriptDb({ settings: {} });

    const result = await updateSetting({ key: "app_name", value: "Umsuka Imbali 2" });

    expect(result).toEqual({ success: true });
    const settings = settingsBuilders();
    expect(settings[0]?.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "app_name",
        value: "Umsuka Imbali 2",
        updated_by: ACTOR_ID,
      }),
      { onConflict: "key" },
    );
  });

  it("includes a fresh updated_at in the upsert payload (ON CONFLICT DO UPDATE keeps the timestamp)", async () => {
    scriptDb({ settings: {} });

    await updateSetting({ key: "app_name", value: "Umsuka Imbali 2" });

    const settings = settingsBuilders();
    expect(settings[0]?.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "app_name",
        updated_at: expect.any(String),
      }),
      { onConflict: "key" },
    );
  });

  it("audits settings.updated exactly once after the upsert", async () => {
    scriptDb({ settings: {}, audit_logs: {} });

    await updateSetting({ key: "instagram_url", value: "https://instagram.com/nuevo" });

    const audits = auditBuilders();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.insert).toHaveBeenCalledWith({
      user_id: ACTOR_ID,
      action: "settings.updated",
      entity_type: "settings",
      entity_id: "instagram_url",
      details: null,
    });
  });

  it("still succeeds when the audit write fails (best-effort)", async () => {
    scriptDb({
      settings: {},
      audit_logs: { error: { message: "permission denied" } },
    });

    const result = await updateSetting({ key: "app_name", value: "Umsuka" });

    expect(result).toEqual({ success: true });
    expect(errorSpy).toHaveBeenCalled();
  });

  it("rejects invalid input without touching the database", async () => {
    scriptDb({ settings: {} });

    const result = await updateSetting({
      key: "bogus",
      value: "x",
    } as unknown as Parameters<typeof updateSetting>[0]);

    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("trims the value before persisting", async () => {
    scriptDb({ settings: {} });

    await updateSetting({ key: "app_name", value: "  Umsuka  " });

    expect(settingsBuilders()[0]?.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ value: "Umsuka" }),
      expect.anything(),
    );
  });

  it("returns the raw error when the upsert fails (no audit)", async () => {
    scriptDb({ settings: { error: { message: "upsert failed" } }, audit_logs: {} });

    const result = await updateSetting({ key: "app_name", value: "Umsuka" });

    expect(result).toEqual({ success: false, error: "upsert failed" });
    expect(auditBuilders()).toHaveLength(0);
  });

  it("denies callers without settings.write", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(makeActor("board_member"));
    scriptDb({ settings: {} });

    const result = await updateSetting({ key: "app_name", value: "Umsuka" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("permisos");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("throws when there is no authenticated actor", async () => {
    vi.mocked(requireAuthenticatedProfile).mockRejectedValue(
      new Error("Se requiere autenticación."),
    );
    scriptDb({ settings: {} });

    await expect(updateSetting({ key: "app_name", value: "Umsuka" })).rejects.toThrow(
      "Se requiere autenticación.",
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ── logAuditAction ──────────────────────────────────────

describe("logAuditAction", () => {
  it("inserts a valid audit row through the authenticated client", async () => {
    scriptDb({ audit_logs: {} });

    await logAuditAction({
      actorId: ACTOR_ID,
      action: "user.role_changed",
      entityType: "profile",
      entityId: TARGET_USER,
      details: { fromRole: "member", toRole: "admin" },
    });

    const audits = auditBuilders();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.insert).toHaveBeenCalledWith({
      user_id: ACTOR_ID,
      action: "user.role_changed",
      entity_type: "profile",
      entity_id: TARGET_USER,
      details: { fromRole: "member", toRole: "admin" },
    });
  });

  it("normalizes missing entityId/details to null in the insert", async () => {
    scriptDb({ audit_logs: {} });

    await logAuditAction({
      actorId: ACTOR_ID,
      action: "user.activated",
      entityType: "profile",
      entityId: TARGET_USER,
    });

    expect(auditBuilders()[0]?.insert).toHaveBeenCalledWith({
      user_id: ACTOR_ID,
      action: "user.activated",
      entity_type: "profile",
      entity_id: TARGET_USER,
      details: null,
    });
  });

  it("never throws on invalid input and does not touch the database", async () => {
    scriptDb({ audit_logs: {} });

    await expect(
      logAuditAction({
        actorId: "not-a-uuid",
        action: "user.role_changed",
        entityType: "profile",
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("never throws when the insert fails (console.error + swallow)", async () => {
    scriptDb({ audit_logs: { error: { message: "insert failed" } } });

    await expect(
      logAuditAction({
        actorId: ACTOR_ID,
        action: "user.activated",
        entityType: "profile",
        entityId: TARGET_USER,
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });

  it("never throws on an unexpected error from the client", async () => {
    scriptDb({});
    vi.mocked(createClient).mockReturnValue({
      from: vi.fn(() => {
        throw new Error("boom");
      }),
    } as unknown as ReturnType<typeof createClient>);

    await expect(
      logAuditAction({
        actorId: ACTOR_ID,
        action: "user.activated",
        entityType: "profile",
        entityId: TARGET_USER,
      }),
    ).resolves.toBeUndefined();
    expect(errorSpy).toHaveBeenCalled();
  });
});

// ── updateUserRole ──────────────────────────────────────

describe("updateUserRole", () => {
  it("reads the previous role, delegates and audits role_changed once", async () => {
    scriptDb({
      profiles: { data: [{ id: TARGET_USER, role: "member" }] },
      audit_logs: {},
    });
    vi.mocked(profilesUpdateMemberRole).mockResolvedValue({ success: true });

    const result = await updateUserRole({ userId: TARGET_USER, role: "event_manager" });

    expect(result).toEqual({ success: true });
    expect(profilesUpdateMemberRole).toHaveBeenCalledWith({
      userId: TARGET_USER,
      role: "event_manager",
    });
    const audits = auditBuilders();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.insert).toHaveBeenCalledWith({
      user_id: ACTOR_ID,
      action: "user.role_changed",
      entity_type: "profile",
      entity_id: TARGET_USER,
      details: { fromRole: "member", toRole: "event_manager" },
    });
  });

  it("audits with fromRole null when the target profile does not exist", async () => {
    scriptDb({ profiles: {}, audit_logs: {} });
    vi.mocked(profilesUpdateMemberRole).mockResolvedValue({ success: true });

    await updateUserRole({ userId: TARGET_USER, role: "member" });

    expect(auditBuilders()[0]?.insert).toHaveBeenCalledWith(
      expect.objectContaining({ details: { fromRole: null, toRole: "member" } }),
    );
  });

  it("does not delegate or audit without users.manage", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(makeActor("board_member"));
    scriptDb({ profiles: {}, audit_logs: {} });

    const result = await updateUserRole({ userId: TARGET_USER, role: "member" });

    expect(result.success).toBe(false);
    expect(profilesUpdateMemberRole).not.toHaveBeenCalled();
    expect(auditBuilders()).toHaveLength(0);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("propagates a delegate failure without auditing", async () => {
    scriptDb({ profiles: { data: [{ id: TARGET_USER, role: "member" }] }, audit_logs: {} });
    vi.mocked(profilesUpdateMemberRole).mockResolvedValue({
      success: false,
      error: "update failed",
    });

    const result = await updateUserRole({ userId: TARGET_USER, role: "admin" });

    expect(result).toEqual({ success: false, error: "update failed" });
    expect(auditBuilders()).toHaveLength(0);
  });

  it("respects canAssignRole: a denial inside the delegate produces no audit", async () => {
    // A plain admin cannot grant the admin role — the delegate returns
    // the canAssignRole error and the wrapper must not write an audit.
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(makeActor("admin"));
    scriptDb({ profiles: { data: [{ id: TARGET_USER, role: "member" }] }, audit_logs: {} });
    vi.mocked(profilesUpdateMemberRole).mockResolvedValue({
      success: false,
      error: "Only a super_admin can grant or revoke the super_admin/admin roles.",
    });

    const result = await updateUserRole({ userId: TARGET_USER, role: "admin" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("super_admin");
    expect(auditBuilders()).toHaveLength(0);
  });

  it("rejects invalid input without touching the database", async () => {
    scriptDb({ profiles: {}, audit_logs: {} });

    const result = await updateUserRole({ userId: "not-a-uuid", role: "member" });

    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(profilesUpdateMemberRole).not.toHaveBeenCalled();
  });
});

// ── setUserActive ───────────────────────────────────────

describe("setUserActive", () => {
  it("delegates and audits user.activated when activating", async () => {
    scriptDb({ audit_logs: {} });
    vi.mocked(profilesSetMemberActive).mockResolvedValue({ success: true });

    const result = await setUserActive({ userId: TARGET_USER, isActive: true });

    expect(result).toEqual({ success: true });
    expect(profilesSetMemberActive).toHaveBeenCalledWith({ userId: TARGET_USER, isActive: true });
    expect(auditBuilders()[0]?.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.activated", entity_id: TARGET_USER }),
    );
  });

  it("delegates and audits user.deactivated when deactivating", async () => {
    scriptDb({ audit_logs: {} });
    vi.mocked(profilesSetMemberActive).mockResolvedValue({ success: true });

    const result = await setUserActive({ userId: TARGET_USER, isActive: false });

    expect(result).toEqual({ success: true });
    expect(auditBuilders()[0]?.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.deactivated", entity_id: TARGET_USER }),
    );
  });

  it("blocks self-deactivation (delegate error) without auditing", async () => {
    scriptDb({ audit_logs: {} });
    vi.mocked(profilesSetMemberActive).mockResolvedValue({
      success: false,
      error: "You cannot deactivate your own account.",
    });

    const result = await setUserActive({ userId: ACTOR_ID, isActive: false });

    expect(result).toEqual({ success: false, error: "You cannot deactivate your own account." });
    expect(auditBuilders()).toHaveLength(0);
  });

  it("denies callers without users.manage (no delegation, no audit)", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(makeActor("event_manager"));
    scriptDb({ audit_logs: {} });

    const result = await setUserActive({ userId: TARGET_USER, isActive: false });

    expect(result.success).toBe(false);
    expect(profilesSetMemberActive).not.toHaveBeenCalled();
    expect(auditBuilders()).toHaveLength(0);
  });

  it("propagates a delegate error without auditing", async () => {
    scriptDb({ audit_logs: {} });
    vi.mocked(profilesSetMemberActive).mockResolvedValue({
      success: false,
      error: "update failed",
    });

    const result = await setUserActive({ userId: TARGET_USER, isActive: true });

    expect(result).toEqual({ success: false, error: "update failed" });
    expect(auditBuilders()).toHaveLength(0);
  });
});

// ── approveUser ─────────────────────────────────────────

describe("approveUser (admin wrapper)", () => {
  it("delegates to the approvals module and audits user.approved once", async () => {
    scriptDb({ audit_logs: {} });
    vi.mocked(approvalsApproveUser).mockResolvedValue({ success: true });

    const result = await approveUser({ userId: TARGET_USER });

    expect(result).toEqual({ success: true });
    expect(approvalsApproveUser).toHaveBeenCalledWith({ userId: TARGET_USER });
    const audits = auditBuilders();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.approved", entity_id: TARGET_USER }),
    );
  });

  it("propagates a delegate failure without auditing", async () => {
    scriptDb({ audit_logs: {} });
    vi.mocked(approvalsApproveUser).mockResolvedValue({
      success: false,
      error: "approval failed",
    });

    const result = await approveUser({ userId: TARGET_USER });

    expect(result).toEqual({ success: false, error: "approval failed" });
    expect(auditBuilders()).toHaveLength(0);
  });

  it("denies callers without users.manage (no delegation, no audit)", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(makeActor("member"));
    scriptDb({ audit_logs: {} });

    const result = await approveUser({ userId: TARGET_USER });

    expect(result.success).toBe(false);
    expect(approvalsApproveUser).not.toHaveBeenCalled();
    expect(auditBuilders()).toHaveLength(0);
  });

  it("rejects invalid input without touching the database", async () => {
    scriptDb({ audit_logs: {} });

    const result = await approveUser({ userId: "not-a-uuid" });

    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
    expect(approvalsApproveUser).not.toHaveBeenCalled();
  });
});

// ── suspendUser ─────────────────────────────────────────

describe("suspendUser (admin wrapper)", () => {
  it("delegates to the approvals module and audits user.suspended once", async () => {
    scriptDb({ audit_logs: {} });
    vi.mocked(approvalsSuspendUser).mockResolvedValue({ success: true });

    const result = await suspendUser({ userId: TARGET_USER });

    expect(result).toEqual({ success: true });
    expect(approvalsSuspendUser).toHaveBeenCalledWith({ userId: TARGET_USER });
    const audits = auditBuilders();
    expect(audits).toHaveLength(1);
    expect(audits[0]?.insert).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.suspended", entity_id: TARGET_USER }),
    );
  });

  it("propagates a self-suspend rejection without auditing", async () => {
    scriptDb({ audit_logs: {} });
    vi.mocked(approvalsSuspendUser).mockResolvedValue({
      success: false,
      error: "No puedes suspender tu propia cuenta.",
    });

    const result = await suspendUser({ userId: ACTOR_ID });

    expect(result).toEqual({ success: false, error: "No puedes suspender tu propia cuenta." });
    expect(auditBuilders()).toHaveLength(0);
  });

  it("denies callers without users.manage (no delegation, no audit)", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(makeActor("guest"));
    scriptDb({ audit_logs: {} });

    const result = await suspendUser({ userId: TARGET_USER });

    expect(result.success).toBe(false);
    expect(approvalsSuspendUser).not.toHaveBeenCalled();
    expect(auditBuilders()).toHaveLength(0);
  });

  it("propagates a delegate failure without auditing", async () => {
    scriptDb({ audit_logs: {} });
    vi.mocked(approvalsSuspendUser).mockResolvedValue({
      success: false,
      error: "suspend failed",
    });

    const result = await suspendUser({ userId: TARGET_USER });

    expect(result).toEqual({ success: false, error: "suspend failed" });
    expect(auditBuilders()).toHaveLength(0);
  });
});