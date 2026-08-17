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
import { updateOwnProfile, updateMemberProfile } from "@/lib/profiles/mutations";
import type { UpdateOwnProfileInput } from "@/lib/profiles/schema";

const mockRequireAuthenticatedProfile = vi.mocked(requireAuthenticatedProfile);

const ACTOR_ID = "323e4567-e89b-12d3-a456-426614174000";
const TARGET_ID = "423e4567-e89b-12d3-a456-426614174000";

// ── Chain-builder stub (mirrors profiles-workgroup.test.ts) ──

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

function member(overrides: Record<string, unknown> = {}) {
  return {
    id: ACTOR_ID,
    role: "member",
    workgroup: "telas",
    componentType: "member",
    ...overrides,
  } as unknown as Awaited<ReturnType<typeof requireAuthenticatedProfile>>;
}

function admin() {
  return {
    id: ACTOR_ID,
    role: "admin",
  } as unknown as Awaited<ReturnType<typeof requireAuthenticatedProfile>>;
}

const enrichedInput: UpdateOwnProfileInput = {
  firstName: "Ana",
  lastName: "García",
  birthDate: "1990-05-12",
  componentType: "member",
  bio: "Bailarina y costurera.",
  phone: "+34 600 123 456",
  skills: ["Baile", "costura"],
  avatarUrl: "https://lh3.googleusercontent.com/a/abc123",
  joinedAt: "2019-03-10",
};

// ── Tests ─────────────────────────────────────────────

describe("updateOwnProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes the enriched fields alongside the classic ones, scoped to the actor", async () => {
    const builders = setupScript([{ table: "profiles" }]);
    mockRequireAuthenticatedProfile.mockResolvedValue(member());

    const result = await updateOwnProfile(enrichedInput);

    expect(result.success).toBe(true);
    expect(builders[0]!.update).toHaveBeenCalledWith({
      first_name: "Ana",
      last_name: "García",
      birth_date: "1990-05-12",
      component_type: "member",
      avatar_url: "https://lh3.googleusercontent.com/a/abc123",
      bio: "Bailarina y costurera.",
      phone: "+34 600 123 456",
      skills: ["Baile", "costura"],
      joined_at: "2019-03-10",
    });
    // Always scoped to the caller's own row.
    expect(builders[0]!.eq).toHaveBeenCalledWith("id", ACTOR_ID);
  });

  it("normalizes skills before writing them", async () => {
    const builders = setupScript([{ table: "profiles" }]);
    mockRequireAuthenticatedProfile.mockResolvedValue(member());

    const result = await updateOwnProfile({
      ...enrichedInput,
      skills: [" Baile ", "Baile", "  costura  "],
    });

    expect(result.success).toBe(true);
    expect(builders[0]!.update).toHaveBeenCalledWith(
      expect.objectContaining({ skills: ["Baile", "costura"] }),
    );
  });

  it("coerces empty optional strings to null before writing", async () => {
    const builders = setupScript([{ table: "profiles" }]);
    mockRequireAuthenticatedProfile.mockResolvedValue(member());

    const result = await updateOwnProfile({
      ...enrichedInput,
      bio: "",
      phone: "",
      avatarUrl: "",
      joinedAt: "",
    });

    expect(result.success).toBe(true);
    expect(builders[0]!.update).toHaveBeenCalledWith(
      expect.objectContaining({
        bio: null,
        phone: null,
        avatar_url: null,
        joined_at: null,
      }),
    );
  });

  it("keeps the music/dance-requires-workgroup rule intact", async () => {
    mockRequireAuthenticatedProfile.mockResolvedValue(
      member({ workgroup: "ninguno", componentType: "member" }),
    );

    const result = await updateOwnProfile({
      ...enrichedInput,
      componentType: "music",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("Música y baile requieren");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns an error for invalid input without touching the database", async () => {
    mockRequireAuthenticatedProfile.mockResolvedValue(member());

    const result = await updateOwnProfile({
      ...enrichedInput,
      phone: "abc",
    });

    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("surfaces database errors verbatim", async () => {
    setupScript([{ table: "profiles", result: { error: { message: "update failed" } } }]);
    mockRequireAuthenticatedProfile.mockResolvedValue(member());

    const result = await updateOwnProfile(enrichedInput);
    expect(result.success).toBe(false);
    expect(result.error).toBe("update failed");
  });
});

describe("updateMemberProfile", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a non-admin actor", async () => {
    mockRequireAuthenticatedProfile.mockResolvedValue(member());

    const result = await updateMemberProfile({
      ...enrichedInput,
      userId: TARGET_ID,
    });

    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("writes the enriched fields for any member when the actor is admin", async () => {
    const builders = setupScript([{ table: "profiles" }]);
    mockRequireAuthenticatedProfile.mockResolvedValue(admin());

    const result = await updateMemberProfile({
      ...enrichedInput,
      userId: TARGET_ID,
      workgroup: "barra",
    });

    expect(result.success).toBe(true);
    expect(builders[0]!.update).toHaveBeenCalledWith({
      first_name: "Ana",
      last_name: "García",
      birth_date: "1990-05-12",
      component_type: "member",
      workgroup: "barra",
      avatar_url: "https://lh3.googleusercontent.com/a/abc123",
      bio: "Bailarina y costurera.",
      phone: "+34 600 123 456",
      skills: ["Baile", "costura"],
      joined_at: "2019-03-10",
    });
    expect(builders[0]!.eq).toHaveBeenCalledWith("id", TARGET_ID);
  });
});
