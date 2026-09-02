import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ requireAuthenticatedProfile: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { createShoppingList, toggleShoppingItemChecked, closeShoppingList } from "@/lib/bar/shopping";
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

function makeTableMock(selectResult: unknown = { data: null, error: null }) {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.insert = vi.fn(() => builder);
  builder.update = vi.fn(() => builder);
  builder.delete = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve(selectResult as never));
  builder.maybeSingle = vi.fn(() => Promise.resolve(selectResult as never));
  builder.limit = vi.fn(() => builder);
  return builder;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue({ from: mockFrom } as unknown as ReturnType<typeof createClient>);
});

describe("createShoppingList", () => {
  it("success for bar_lead", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor());
    const tbl = makeTableMock({ data: { id: "new-list" }, error: null });
    mockFrom.mockReturnValue(tbl as never);
    const res = await createShoppingList({ title: "Lista 1" });
    expect(res.success).toBe(true);
  });
  it("fails for member", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor({ isWorkgroupLead: false, workgroup: "ninguno" }));
    const res = await createShoppingList({ title: "Lista 1" });
    expect(res.success).toBe(false);
  });
});

describe("toggleShoppingItemChecked", () => {
  it("success", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor());
    const tbl = makeTableMock({ data: { id: "item-1" }, error: null });
    mockFrom.mockReturnValue(tbl as never);
    const res = await toggleShoppingItemChecked({ id: "123e4567-e89b-12d3-a456-426614174000", is_checked: true });
    expect(res.success).toBe(true);
  });
});

describe("closeShoppingList", () => {
  it("success", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor());
    const tbl = makeTableMock({ data: { id: "list-1" }, error: null });
    mockFrom.mockReturnValue(tbl as never);
    const res = await closeShoppingList({ id: "123e4567-e89b-12d3-a456-426614174000" });
    expect(res.success).toBe(true);
  });
});
