import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the supabase clients
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

import { createAdminClient } from "@/lib/supabase/admin";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { approveUser, suspendUser } from "@/lib/approvals/mutations";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174000";
const ANOTHER_UUID = "223e4567-e89b-12d3-a456-426614174000";

describe("approveUser", () => {
  const mockFrom = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    vi.mocked(createAdminClient).mockReturnValue({
      from: mockFrom,
    } as any);
  });

  it("returns error for invalid input", async () => {
    const result = await approveUser({ userId: "not-a-uuid" });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns error when caller is not admin", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue({
      id: ANOTHER_UUID,
      role: "member",
    } as any);

    const result = await approveUser({ userId: VALID_UUID });
    expect(result.success).toBe(false);
    expect(result.error).toContain("permisos");
  });

  it("approves a pending user when caller is super_admin", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue({
      id: ANOTHER_UUID,
      role: "super_admin",
    } as any);

    const result = await approveUser({ userId: VALID_UUID });

    expect(result.success).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith("profiles");
  });

  it("approves a pending user when caller is admin", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue({
      id: ANOTHER_UUID,
      role: "admin",
    } as any);

    const result = await approveUser({ userId: VALID_UUID });

    expect(result.success).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith("profiles");
  });

  it("returns error when the DB update fails", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue({
      id: ANOTHER_UUID,
      role: "super_admin",
    } as any);

    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: { message: "Database error" } }),
    });

    const result = await approveUser({ userId: VALID_UUID });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Database error");
  });
});

describe("suspendUser", () => {
  const mockFrom = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();

    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: null }),
    });

    vi.mocked(createAdminClient).mockReturnValue({
      from: mockFrom,
    } as any);
  });

  it("returns error for invalid input", async () => {
    const result = await suspendUser({ userId: "not-a-uuid" });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("returns error when caller is not admin", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue({
      id: ANOTHER_UUID,
      role: "board_member",
    } as any);

    const result = await suspendUser({ userId: VALID_UUID });
    expect(result.success).toBe(false);
    expect(result.error).toContain("permisos");
  });

  it("prevents self-suspension", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue({
      id: VALID_UUID,
      role: "super_admin",
    } as any);

    const result = await suspendUser({ userId: VALID_UUID });
    expect(result.success).toBe(false);
    expect(result.error).toContain("No puedes suspender");
  });

  it("suspends a user when caller is super_admin", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue({
      id: ANOTHER_UUID,
      role: "super_admin",
    } as any);

    const result = await suspendUser({ userId: VALID_UUID });

    expect(result.success).toBe(true);
    expect(mockFrom).toHaveBeenCalledWith("profiles");
  });

  it("returns error when the DB update fails", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue({
      id: ANOTHER_UUID,
      role: "super_admin",
    } as any);

    mockFrom.mockReturnValue({
      update: vi.fn().mockReturnThis(),
      eq: vi.fn().mockResolvedValue({ error: { message: "DB error" } }),
    });

    const result = await suspendUser({ userId: VALID_UUID });
    expect(result.success).toBe(false);
    expect(result.error).toBe("DB error");
  });
});
