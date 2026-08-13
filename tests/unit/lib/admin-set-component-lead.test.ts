import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted above the imports below by vitest) ──

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { setComponentLeadAction } from "@/app/admin/users/actions";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { revalidatePath } from "next/cache";
import type { AuthenticatedProfile } from "@/types/auth";

const mockRequireAuthenticatedProfile = vi.mocked(requireAuthenticatedProfile);
const mockRevalidatePath = vi.mocked(revalidatePath);

// ── Chain-builder stub (mirrors src/lib/members/__tests__/queries.test.ts) ──

interface QueryResult {
  data?: unknown[] | null;
  error?: Error | null;
}

/**
 * Builds a profiles-chain stub. `selectResult` feeds the pre-update
 * target-profile read (maybeSingle), `updateResult` feeds the awaited
 * update call, so tests can exercise the guard and the update separately.
 */
function makeTableMock(selectResult: QueryResult = {}, updateResult: QueryResult = {}) {
  const thenableUpdate = Promise.resolve(updateResult);

  const builder = {
    select: vi.fn(() => builder),
    order: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    maybeSingle: vi.fn(() =>
      Promise.resolve(
        Array.isArray(selectResult.data)
          ? { data: selectResult.data[0] ?? null, error: selectResult.error ?? null }
          : selectResult,
      ),
    ),
    single: vi.fn(() =>
      Promise.resolve(
        Array.isArray(selectResult.data)
          ? { data: selectResult.data[0] ?? null, error: selectResult.error ?? null }
          : selectResult,
      ),
    ),
    update: vi.fn(() => builder),
    then: thenableUpdate.then.bind(thenableUpdate),
    catch: thenableUpdate.catch.bind(thenableUpdate),
    finally: thenableUpdate.finally.bind(thenableUpdate),
  };

  return builder;
}

function setupProfilesMock(selectResult: QueryResult = {}, updateResult: QueryResult = {}) {
  const builder = makeTableMock(selectResult, updateResult);
  mockFrom.mockImplementation((table: string) => {
    if (table !== "profiles") {
      throw new Error(`Unexpected table in test mock: ${table}`);
    }
    return builder;
  });
  return builder;
}

/** Target profile row as returned by the pre-update guard select. */
function activeTarget(userId: string) {
  return { id: userId, status: "active", is_active: true };
}

function superAdmin(): AuthenticatedProfile {
  return {
    id: "actor-1",
    firstName: "Marta",
    lastName: "Admin",
    email: null,
    avatarUrl: null,
    role: "super_admin",
    componentType: "member",
    workgroup: "ninguno",
    isWorkgroupLead: false,
    componentLeadFor: null,
    birthDate: null,
    isActive: true,
    status: "active",
    username: null,
    authMethod: "google",
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function plainAdmin(): AuthenticatedProfile {
  return { ...superAdmin(), role: "admin" };
}

// ── Tests ─────────────────────────────────────────────

describe("setComponentLeadAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects non-super-admins without touching the database", async () => {
    setupProfilesMock();
    mockRequireAuthenticatedProfile.mockResolvedValue(plainAdmin());

    const result = await setComponentLeadAction("user-1", "music");

    expect(result.success).toBe(false);
    expect(result.error).toContain("super admin");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("designates a component lead when called by the super admin", async () => {
    const builder = setupProfilesMock({ data: [activeTarget("user-1")] });
    mockRequireAuthenticatedProfile.mockResolvedValue(superAdmin());

    const result = await setComponentLeadAction("user-1", "music");

    expect(result.success).toBe(true);
    expect(builder.update).toHaveBeenCalledWith({ component_lead_for: "music" });
    expect(builder.eq).toHaveBeenCalledWith("id", "user-1");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/users");
  });

  it("clears the designation when component is null", async () => {
    const builder = setupProfilesMock();
    mockRequireAuthenticatedProfile.mockResolvedValue(superAdmin());

    const result = await setComponentLeadAction("user-1", null);

    expect(result.success).toBe(true);
    expect(builder.update).toHaveBeenCalledWith({ component_lead_for: null });
  });

  it("rejects designating a suspended target with a friendly error (no update)", async () => {
    const builder = setupProfilesMock({
      data: [{ id: "user-1", status: "suspended", is_active: true }],
    });
    mockRequireAuthenticatedProfile.mockResolvedValue(superAdmin());

    const result = await setComponentLeadAction("user-1", "music");

    expect(result.success).toBe(false);
    expect(result.error).toBe("El miembro debe estar activo para ser designado responsable.");
    expect(builder.update).not.toHaveBeenCalled();
  });

  it("rejects designating a pending or deactivated (baja) target", async () => {
    mockRequireAuthenticatedProfile.mockResolvedValue(superAdmin());

    const pending = setupProfilesMock({
      data: [{ id: "user-1", status: "pending", is_active: true }],
    });
    expect(await setComponentLeadAction("user-1", "music")).toEqual({
      success: false,
      error: "El miembro debe estar activo para ser designado responsable.",
    });
    expect(pending.update).not.toHaveBeenCalled();

    const deactivated = setupProfilesMock({
      data: [{ id: "user-1", status: "active", is_active: false }],
    });
    expect(await setComponentLeadAction("user-1", "music")).toEqual({
      success: false,
      error: "El miembro debe estar activo para ser designado responsable.",
    });
    expect(deactivated.update).not.toHaveBeenCalled();
  });

  it("rejects designating a non-existent target (no update)", async () => {
    const builder = setupProfilesMock({ data: [] });
    mockRequireAuthenticatedProfile.mockResolvedValue(superAdmin());

    const result = await setComponentLeadAction("missing", "music");

    expect(result.success).toBe(false);
    expect(result.error).toBe("El miembro debe estar activo para ser designado responsable.");
    expect(builder.update).not.toHaveBeenCalled();
  });

  it("returns a friendly Spanish message on a 23505 unique violation (already a lead)", async () => {
    setupProfilesMock(
      { data: [activeTarget("user-2")] },
      {
        error: Object.assign(new Error("duplicate key value violates unique constraint"), {
          code: "23505",
        }),
      },
    );
    mockRequireAuthenticatedProfile.mockResolvedValue(superAdmin());

    const result = await setComponentLeadAction("user-2", "music");

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Ya existe un responsable designado para ese componente. Quítale el cargo al responsable actual primero.",
    );
  });

  it("also detects the violation when the message names idx_profiles_component_lead_for without a code", async () => {
    setupProfilesMock(
      { data: [activeTarget("user-2")] },
      {
        error: new Error(
          'duplicate key value violates unique constraint "idx_profiles_component_lead_for"',
        ),
      },
    );
    mockRequireAuthenticatedProfile.mockResolvedValue(superAdmin());

    const result = await setComponentLeadAction("user-2", "dance");

    expect(result.success).toBe(false);
    expect(result.error).toContain("Ya existe un responsable designado");
  });

  it("does not misclassify unrelated duplicate-key errors without the index name", async () => {
    setupProfilesMock(
      { data: [activeTarget("user-2")] },
      {
        error: new Error('duplicate key value violates unique constraint "some_other_index"'),
      },
    );
    mockRequireAuthenticatedProfile.mockResolvedValue(superAdmin());

    const result = await setComponentLeadAction("user-2", "music");

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      'duplicate key value violates unique constraint "some_other_index"',
    );
  });

  it("surfaces other database errors verbatim", async () => {
    setupProfilesMock({ data: [activeTarget("user-1")] }, { error: new Error("connection refused") });
    mockRequireAuthenticatedProfile.mockResolvedValue(superAdmin());

    const result = await setComponentLeadAction("user-1", "music");

    expect(result.success).toBe(false);
    expect(result.error).toBe("connection refused");
  });
});