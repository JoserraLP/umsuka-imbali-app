import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetCurrentProfile = vi.fn();
const mockAdminFrom = vi.fn();

vi.mock("@/lib/auth/session", () => ({
  getCurrentProfile: (...args: unknown[]) => mockGetCurrentProfile(...args),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({
    auth: { getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "u1", email: "test@gmail.com" } } })) },
    from: vi.fn(),
  })),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(() => ({ from: mockAdminFrom })),
}));

import { preRegisterMember, linkGmailToProfile } from "@/lib/members/pre-register";

function makeAdminInsertMock() {
  const single = vi.fn(() => Promise.resolve({ data: { id: "new-id", invite_token: "tok-123" }, error: null }));
  const select = vi.fn(() => ({ single }));
  const insert = vi.fn(() => ({ select }));
  return { insert, select, single };
}

function _makeLinkMocks({ target = { id: "pid", link_status: "pending_gmail", invite_token: "tok-123" }, collision = null }: { target?: unknown; collision?: unknown } = {}) {
  const collisionSingle = vi.fn(() => Promise.resolve({ data: collision }));
  const collisionEq2 = vi.fn(() => ({ maybeSingle: collisionSingle }));
  const collisionEq1 = vi.fn(() => ({ eq: collisionEq2 }));
  const collisionSelect = vi.fn(() => ({ eq: collisionEq1 }));

  const targetSingle = vi.fn(() => Promise.resolve({ data: target, error: null }));
  const targetEq = vi.fn(() => ({ maybeSingle: targetSingle }));
  const targetSelect = vi.fn(() => ({ eq: targetEq }));

  const updateEq = vi.fn(() => Promise.resolve({ error: null }));
  const updateBuilder = vi.fn(() => ({ eq: updateEq }));

  return { collisionSelect, targetSelect, updateBuilder, targetEq, collisionSingle, targetSingle, updateEq };
}

describe("preRegisterMember", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fails when not super_admin (fail-closed)", async () => {
    mockGetCurrentProfile.mockResolvedValue({ id: "u1", role: "member" });
    const result = await preRegisterMember({ first_name: "Ana", last_name: "García", component_type: "dance", workgroup: "telas", role: "member", is_minor: false });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("super_admin");
  });

  it("succeeds for super_admin and generates token", async () => {
    mockGetCurrentProfile.mockResolvedValue({ id: "admin-id", role: "super_admin" });
    const { insert } = makeAdminInsertMock();
    mockAdminFrom.mockImplementation((table: string) => {
      if (table === "profiles") return { insert };
      return { select: vi.fn() };
    });
    const result = await preRegisterMember({ first_name: "Ana", last_name: "García", component_type: "music", workgroup: "barra", role: "member", is_minor: false });
    expect(result.success).toBe(true);
    expect(insert).toHaveBeenCalled();
    const insertedArg = (insert.mock.calls[0] as unknown as [Record<string, unknown>] )?.[0];
    expect(insertedArg?.link_status).toBe("pending_gmail");
    expect(insertedArg?.invite_token).toBeDefined();
  });

  it("preserves history: does not touch other tables (only profiles insert)", async () => {
    mockGetCurrentProfile.mockResolvedValue({ id: "admin-id", role: "super_admin" });
    const { insert } = makeAdminInsertMock();
    const fromSpy = vi.fn((table: string) => {
      if (table === "profiles") return { insert };
      return { select: vi.fn() };
    });
    mockAdminFrom.mockImplementation(fromSpy as never);
    await preRegisterMember({ first_name: "Pepe", last_name: "Pérez", component_type: "member", workgroup: "ninguno", role: "member", is_minor: false });
    expect(fromSpy).toHaveBeenCalledWith("profiles");
    expect(fromSpy).not.toHaveBeenCalledWith("member_payments");
  });
});

describe("linkGmailToProfile", () => {
  beforeEach(() => vi.clearAllMocks());

  it("fails when not super_admin", async () => {
    mockGetCurrentProfile.mockResolvedValue({ id: "u1", role: "member" });
    const result = await linkGmailToProfile({ profileId: "550e8400-e29b-41d4-a716-446655440000", gmail: "a@gmail.com" });
    expect(result.success).toBe(false);
  });

  it("fails on collision gmail already linked", async () => {
    mockGetCurrentProfile.mockResolvedValue({ id: "admin-id", role: "super_admin" });
    // collision found
    const collSingle = vi.fn(() => Promise.resolve({ data: { id: "other" } }));
    const collEq2 = vi.fn(() => ({ maybeSingle: collSingle }));
    const collEq1 = vi.fn(() => ({ eq: collEq2 }));
    const collSelect = vi.fn(() => ({ eq: collEq1 }));
    mockAdminFrom.mockImplementation((t: string) => {
      if (t === "profiles") return { select: collSelect } as never;
      return {} as never;
    });
    const result = await linkGmailToProfile({ profileId: "550e8400-e29b-41d4-a716-446655440000", gmail: "taken@gmail.com" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("ya pertenece");
  });

  it("fails when profile not pending_gmail", async () => {
    mockGetCurrentProfile.mockResolvedValue({ id: "admin-id", role: "super_admin" });
    const collSingle = vi.fn(() => Promise.resolve({ data: null }));
    const collEq2 = vi.fn(() => ({ maybeSingle: collSingle }));
    const collEq1 = vi.fn(() => ({ eq: collEq2 }));
    const collSelect = vi.fn(() => ({ eq: collEq1 }));

    const targetSingle = vi.fn(() => Promise.resolve({ data: { id: "pid", link_status: "linked", invite_token: null }, error: null }));
    const targetEq = vi.fn(() => ({ maybeSingle: targetSingle }));
    const targetSelect = vi.fn(() => ({ eq: targetEq }));

    let call = 0;
    mockAdminFrom.mockImplementation(() => ({
      select: vi.fn(() => {
        call++;
        if (call === 1) return { eq: collEq1 } as never;
        return { eq: targetEq } as never;
      }),
      from: undefined,
    } as never));
    // Simpler: sequence via mockAdminFrom calls
    mockAdminFrom.mockImplementation((() => {
      let n = 0;
      return () => {
        n++;
        if (n === 1) return { select: collSelect } as never;
        if (n === 2) return { select: targetSelect } as never;
        return { select: collSelect } as never;
      };
    })() as never);

    // Alternative direct: just mock to return pending check
    mockAdminFrom.mockReset();
    let seq = 0;
    mockAdminFrom.mockImplementation(((_table: string) => {
      seq++;
      if (seq === 1) return { select: collSelect } as never;
      if (seq === 2) return { select: targetSelect } as never;
      return { select: collSelect } as never;
    }) as never);

    const result = await linkGmailToProfile({ profileId: "550e8400-e29b-41d4-a716-446655440000", gmail: "new@gmail.com" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("no está pendiente");
  });

  it("fails when invite_token invalid", async () => {
    mockGetCurrentProfile.mockResolvedValue({ id: "admin-id", role: "super_admin" });
    const collSingle = vi.fn(() => Promise.resolve({ data: null }));
    const collEq2 = vi.fn(() => ({ maybeSingle: collSingle }));
    const collEq1 = vi.fn(() => ({ eq: collEq2 }));
    const collSelect = vi.fn(() => ({ eq: collEq1 }));
    const targetSingle = vi.fn(() => Promise.resolve({ data: { id: "pid", link_status: "pending_gmail", invite_token: "tok-real" }, error: null }));
    const targetEq = vi.fn(() => ({ maybeSingle: targetSingle }));
    const targetSelect = vi.fn(() => ({ eq: targetEq }));
    let seq = 0;
    mockAdminFrom.mockImplementation((() => {
      seq++;
      if (seq === 1) return { select: collSelect } as never;
      if (seq === 2) return { select: targetSelect } as never;
      return { select: collSelect } as never;
    }) as never);
    const result = await linkGmailToProfile({ profileId: "550e8400-e29b-41d4-a716-446655440000", gmail: "new@gmail.com", invite_token: "wrong-token" });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error).toContain("Token");
  });
});
