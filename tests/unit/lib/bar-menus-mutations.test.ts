import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAuthenticatedProfile: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { createBarItem, updateBarPrice, toggleVisibility } from "@/lib/bar/menus";
import type { AuthenticatedProfile } from "@/types/auth";

const mockFrom = vi.fn();

function actor(overrides: Partial<AuthenticatedProfile> = {}): AuthenticatedProfile {
  return {
    id: "actor-1",
    firstName: "Ana",
    lastName: "Barra",
    email: null,
    avatarUrl: null,
    role: "member",
    componentType: "member",
    workgroup: "barra",
    isWorkgroupLead: true,
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
    ...overrides,
  } as AuthenticatedProfile;
}

function makeTableMock(selectResult: unknown = { data: null, error: null }, awaitedResult: unknown = { data: null, error: null }) {
  const builder: Record<string, unknown> = {};
  let lastOp: "select" | "insert" | "update" = "select";
  builder.select = vi.fn(() => { lastOp = "select"; return builder; });
  builder.eq = vi.fn(() => builder);
  builder.insert = vi.fn(() => { lastOp = "insert"; return builder; });
  builder.update = vi.fn(() => { lastOp = "update"; return builder; });
  builder.delete = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.ilike = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve(selectResult as never));
  builder.maybeSingle = vi.fn(() => Promise.resolve(selectResult as never));
  // thenable
  builder.then = (onFulfilled: (v: unknown) => unknown) => Promise.resolve(lastOp === "insert" || lastOp === "update" ? awaitedResult : selectResult).then(onFulfilled as never);
  builder.catch = (onRejected: never) => Promise.resolve(selectResult).catch(onRejected);
  builder.finally = (onFinally: never) => Promise.resolve(selectResult).finally(onFinally as never);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue({ from: mockFrom } as unknown as ReturnType<typeof createClient>);
});

describe("createBarItem", () => {
  it("success for bar_lead", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor());
    const tbl = makeTableMock({ data: { id: "new-id" }, error: null });
    mockFrom.mockReturnValue(tbl as never);
    const res = await createBarItem({ name: "Cerveza", category: "drink", price: 2.5 } as unknown as Parameters<typeof createBarItem>[0]);
    expect(res.success).toBe(true);
    expect(res.id).toBe("new-id");
  });
  it("fails for non-bar member", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor({ isWorkgroupLead: false, workgroup: "ninguno" }));
    const res = await createBarItem({ name: "x", category: "drink", price: 2 } as unknown as Parameters<typeof createBarItem>[0]);
    expect(res.success).toBe(false);
    expect(res.error).toContain("responsable");
    expect(mockFrom).not.toHaveBeenCalled();
  });
  it("success for super_admin even if not lead", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor({ role: "super_admin", isWorkgroupLead: false, workgroup: "ninguno" }));
    const tbl = makeTableMock({ data: { id: "new-id" }, error: null });
    mockFrom.mockReturnValue(tbl as never);
    const res = await createBarItem({ name: "x", category: "drink", price: 2 } as unknown as Parameters<typeof createBarItem>[0]);
    expect(res.success).toBe(true);
  });
});

describe("updateBarPrice", () => {
  it("success", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor());
    const tbl = makeTableMock({ data: { id: "bid" }, error: null });
    mockFrom.mockReturnValue(tbl as never);
    const res = await updateBarPrice({ id: "123e4567-e89b-12d3-a456-426614174000", price: 5 });
    expect(res.success).toBe(true);
  });
  it("fails for non-bar", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor({ isWorkgroupLead: false, workgroup: "ninguno" }));
    const res = await updateBarPrice({ id: "123e4567-e89b-12d3-a456-426614174000", price: 5 });
    expect(res.success).toBe(false);
  });
});

describe("toggleVisibility", () => {
  it("updates is_visible_to_members", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor());
    const tbl = makeTableMock({ data: { id: "bid" }, error: null });
    mockFrom.mockReturnValue(tbl as never);
    const res = await toggleVisibility({ id: "123e4567-e89b-12d3-a456-426614174000", is_visible_to_members: false });
    expect(res.success).toBe(true);
    expect(tbl.update).toHaveBeenCalledWith({ is_visible_to_members: false });
  });
});
