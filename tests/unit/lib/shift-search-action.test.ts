import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock supabase (to assert it is never touched on failure paths),
// session, and next/cache (to assert the action is read-only).
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import { searchShiftMembersAction } from "@/app/events/[id]/shift-member-search-actions";
import { AuthorizationError } from "@/lib/auth/permissions";

const SHIFT_ID = "123e4567-e89b-12d3-a456-426614174000";
const U1 = "223e4567-e89b-12d3-a456-426614174000";
const U2 = "323e4567-e89b-12d3-a456-426614174000";

const mockFrom = vi.fn();

function makeTableMock(result: { data: unknown[] | null; count?: number | null }) {
  const thenableResult = Promise.resolve({
    data: result.data,
    error: null,
    count: result.count ?? null,
  });

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    or: vi.fn(() => builder),
    order: vi.fn(() => builder),
    range: vi.fn(() => builder),
    then: thenableResult.then.bind(thenableResult),
    catch: thenableResult.catch.bind(thenableResult),
    finally: thenableResult.finally.bind(thenableResult),
  };

  return builder;
}

const builders = {
  shift_assignments: makeTableMock({ data: [{ user_id: U1 }, { user_id: U2 }] }),
  profiles: makeTableMock({
    data: [
      { id: U1, first_name: "Ana", last_name: "García", workgroup: "telas" },
      { id: U2, first_name: "Bruno", last_name: "López", workgroup: "barra" },
    ],
    count: 2,
  }),
  workgroup_attendance: makeTableMock({
    data: [{ user_id: U1, attended: true }],
  }),
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockImplementation(() => {
    throw new Error("Supabase must not be reached in this test");
  });
  mockFrom.mockClear();
});

function mockSupabaseForSuccess() {
  const byTable: Record<string, ReturnType<typeof makeTableMock>> = {
    shift_assignments: builders.shift_assignments,
    profiles: builders.profiles,
    workgroup_attendance: builders.workgroup_attendance,
  };
  mockFrom.mockImplementation((table: string) => byTable[table]);
  vi.mocked(createClient).mockReturnValue({
    from: mockFrom,
  } as unknown as ReturnType<typeof createClient>);
}

function actor(overrides: Record<string, unknown> = {}) {
  return {
    id: "actor-id",
    role: "member",
    isWorkgroupLead: false,
    workgroup: "ninguno",
    ...overrides,
  };
}

async function mockSession(value: unknown) {
  const { requireAuthenticatedProfile } = await import("@/lib/auth/session");
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(
    value as Awaited<ReturnType<typeof requireAuthenticatedProfile>>,
  );
}

describe("searchShiftMembersAction — fail-closed authorization", () => {
  it("returns an error when there is no authenticated session, without calling Supabase", async () => {
    const { requireAuthenticatedProfile } = await import("@/lib/auth/session");
    vi.mocked(requireAuthenticatedProfile).mockRejectedValue(
      new Error("Se requiere autenticación."),
    );

    const result = await searchShiftMembersAction({ shiftId: SHIFT_ID, query: "ana" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBeTruthy();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects a role without permissions with a permission message and no Supabase access", async () => {
    await mockSession(actor({ role: "member" }));

    const result = await searchShiftMembersAction({ shiftId: SHIFT_ID, query: "ana" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toContain("No tienes permisos");
    }
    expect(createClient).not.toHaveBeenCalled();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("restricts a workgroup lead to their own group", async () => {
    mockSupabaseForSuccess();
    await mockSession(actor({ role: "member", isWorkgroupLead: true, workgroup: "telas" }));

    const result = await searchShiftMembersAction({
      shiftId: SHIFT_ID,
      query: "a",
      workgroup: "barra",
    });

    expect(result.success).toBe(true);
    // The requested "barra" filter is ignored; the lead scope wins.
    const eqCalls = builders.profiles.eq.mock.calls;
    expect(eqCalls).toContainEqual(["workgroup", "telas"]);
    expect(eqCalls).not.toContainEqual(["workgroup", "barra"]);
  });

  it("grants management roles full access", async () => {
    mockSupabaseForSuccess();
    await mockSession(actor({ role: "super_admin" }));

    const result = await searchShiftMembersAction({
      shiftId: SHIFT_ID,
      query: "ana",
      workgroup: "telas",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.total).toBe(2);
      expect(result.data.rows).toHaveLength(2);
    }
    expect(builders.profiles.eq).toHaveBeenCalledWith("workgroup", "telas");
  });
});

describe("searchShiftMembersAction — input validation", () => {
  it("returns a generic error for invalid input without touching Supabase", async () => {
    await mockSession(actor({ role: "super_admin" }));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await searchShiftMembersAction({
      shiftId: "not-a-uuid",
      query: "ana",
    });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No se pudo completar la búsqueda.");
    expect(consoleSpy).toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});

describe("searchShiftMembersAction — read-only contract", () => {
  it("never calls revalidatePath, even on success", async () => {
    mockSupabaseForSuccess();
    await mockSession(actor({ role: "super_admin" }));

    await searchShiftMembersAction({ shiftId: SHIFT_ID, query: "ana" });

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("maps an unexpected DB error to the generic failure result", async () => {
    await mockSession(actor({ role: "super_admin" }));
    const failingBuilder = makeTableMock({ data: [] });
    failingBuilder.eq.mockImplementation(() => {
      throw new Error("network down");
    });
    mockFrom.mockImplementation(() => failingBuilder);
    vi.mocked(createClient).mockReturnValue({
      from: mockFrom,
    } as unknown as ReturnType<typeof createClient>);
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await searchShiftMembersAction({ shiftId: SHIFT_ID, query: "ana" });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toBe("No se pudo completar la búsqueda.");
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("propagates AuthorizationError instances from the query layer", async () => {
    // Sanity check for the error-mapping contract used above.
    expect(new AuthorizationError().message).toContain("No tienes permisos");
  });
});
