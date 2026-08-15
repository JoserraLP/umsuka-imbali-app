import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by vitest) ──────────────────────────

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { setMyWorkgroup, updateMemberWorkgroup } from "@/lib/profiles/mutations";

const mockRequireAuthenticatedProfile = vi.mocked(requireAuthenticatedProfile);

const ACTOR_ID = "323e4567-e89b-12d3-a456-426614174000";
const TARGET_ID = "423e4567-e89b-12d3-a456-426614174000";

// ── Chain-builder stub (mirrors admin-set-component-lead.test.ts) ──

interface DbResult {
  data?: unknown | unknown[] | null;
  error?: { message: string; code?: string } | null;
}

function makeTableMock(result: DbResult = {}) {
  const chainValue = { data: result.data ?? null, error: result.error ?? null };
  const thenable = Promise.resolve(chainValue);

  const builder = {
    select: vi.fn(() => builder),
    update: vi.fn(() => builder),
    eq: vi.fn(() => builder),
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

function setupScript(script: Array<{ table: string; result?: DbResult }>) {
  const builders: ReturnType<typeof makeTableMock>[] = [];
  let index = 0;
  mockFrom.mockImplementation((table: string) => {
    const step = script[index];
    if (!step || step.table !== table) {
      throw new Error(
        `Unexpected table "${table}" at call ${index} (expected "${step?.table ?? "none"}")`,
      );
    }
    index += 1;
    const builder = makeTableMock(step.result);
    builders.push(builder);
    return builder;
  });
  return builders;
}

function member() {
  return {
    id: ACTOR_ID,
    role: "member",
    workgroup: "ninguno",
    componentType: "member",
  } as unknown as Awaited<ReturnType<typeof requireAuthenticatedProfile>>;
}

function superAdmin() {
  return {
    id: ACTOR_ID,
    role: "super_admin",
  } as unknown as Awaited<ReturnType<typeof requireAuthenticatedProfile>>;
}

function plainAdmin() {
  return {
    id: ACTOR_ID,
    role: "admin",
  } as unknown as Awaited<ReturnType<typeof requireAuthenticatedProfile>>;
}

// ── Tests ─────────────────────────────────────────────

describe("setMyWorkgroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error for invalid input (including 'ninguno')", async () => {
    const ninguno = await setMyWorkgroup({ workgroup: "ninguno" as never });
    expect(ninguno.success).toBe(false);
    expect(ninguno.error).toBeDefined();

    const unknown = await setMyWorkgroup({ workgroup: "cocina" as never });
    expect(unknown.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("updates the caller's own workgroup", async () => {
    const builders = setupScript([{ table: "profiles" }]);
    mockRequireAuthenticatedProfile.mockResolvedValue(member());

    const result = await setMyWorkgroup({ workgroup: "telas" });

    expect(result.success).toBe(true);
    expect(builders[0]!.update).toHaveBeenCalledWith({ workgroup: "telas" });
    // Always scoped to the actor's own row, never to another user.
    expect(builders[0]!.eq).toHaveBeenCalledWith("id", ACTOR_ID);
  });

  it("surfaces database errors verbatim", async () => {
    setupScript([{ table: "profiles", result: { error: { message: "update failed" } } }]);
    mockRequireAuthenticatedProfile.mockResolvedValue(member());

    const result = await setMyWorkgroup({ workgroup: "barra" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("update failed");
  });
});

describe("updateMemberWorkgroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error for invalid input", async () => {
    const result = await updateMemberWorkgroup({ userId: "not-a-uuid", workgroup: "telas" });
    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects a plain admin (only the super admin can change workgroups)", async () => {
    mockRequireAuthenticatedProfile.mockResolvedValue(plainAdmin());

    const result = await updateMemberWorkgroup({ userId: TARGET_ID, workgroup: "telas" });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "Solo el super admin puede cambiar el grupo de trabajo de un miembro.",
    );
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("lets the super admin change a member's workgroup", async () => {
    const builders = setupScript([
      { table: "profiles", result: { data: [{ component_type: "member" }] } },
      { table: "profiles" },
    ]);
    mockRequireAuthenticatedProfile.mockResolvedValue(superAdmin());

    const result = await updateMemberWorkgroup({ userId: TARGET_ID, workgroup: "limpieza" });

    expect(result.success).toBe(true);
    expect(builders[1]!.update).toHaveBeenCalledWith({ workgroup: "limpieza" });
    expect(builders[1]!.eq).toHaveBeenCalledWith("id", TARGET_ID);
  });

  it("prevents moving a music/dance member to 'ninguno'", async () => {
    setupScript([{ table: "profiles", result: { data: [{ component_type: "dance" }] } }]);
    mockRequireAuthenticatedProfile.mockResolvedValue(superAdmin());

    const result = await updateMemberWorkgroup({ userId: TARGET_ID, workgroup: "ninguno" });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Música y baile requieren");
  });

  it("surfaces database errors verbatim", async () => {
    setupScript([
      { table: "profiles", result: { data: [{ component_type: "member" }] } },
      { table: "profiles", result: { error: { message: "update failed" } } },
    ]);
    mockRequireAuthenticatedProfile.mockResolvedValue(superAdmin());

    const result = await updateMemberWorkgroup({ userId: TARGET_ID, workgroup: "barra" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("update failed");
  });
});
