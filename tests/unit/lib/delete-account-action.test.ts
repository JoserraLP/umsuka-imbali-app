import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by vitest) ──────────────────────────

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/delete-account", () => ({
  deleteAccountPermanently: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentProfile: vi.fn(),
  requireAuthenticatedProfile: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/admin/mutations", () => ({
  updateSetting: vi.fn(),
  approveUser: vi.fn(),
  suspendUser: vi.fn(),
  updateUserRole: vi.fn(),
  setUserActive: vi.fn(),
  logAuditAction: vi.fn(),
}));

vi.mock("@/lib/profiles/mutations", () => ({
  updateMemberProfile: vi.fn(),
  updateMemberComponentType: vi.fn(),
  updateMemberWorkgroup: vi.fn(),
}));

vi.mock("@/lib/auth/admin-create", () => ({
  createEmaillessAccount: vi.fn(),
}));

vi.mock("@/lib/auth/password-service", () => ({
  generateResetToken: vi.fn(),
  adminUnlockAccount: vi.fn(),
}));

import { revalidatePath } from "next/cache";
import { deleteAccountPermanently } from "@/lib/auth/delete-account";
import { deleteAccountPermanentlyAction } from "@/app/admin/users/actions";

const mockDeleteAccountPermanently = vi.mocked(deleteAccountPermanently);
const mockRevalidatePath = vi.mocked(revalidatePath);

const TARGET_USER = "323e4567-e89b-12d3-a456-426614174000";

beforeEach(() => {
  vi.clearAllMocks();
});

// ── deleteAccountPermanentlyAction ──────────────────────

describe("deleteAccountPermanentlyAction", () => {
  it("delegates to the service and revalidates both admin views on success", async () => {
    mockDeleteAccountPermanently.mockResolvedValue({ success: true });

    const result = await deleteAccountPermanentlyAction({
      userId: TARGET_USER,
      confirmation: "ELIMINAR",
    });

    expect(result).toEqual({ success: true });
    expect(mockDeleteAccountPermanently).toHaveBeenCalledWith(TARGET_USER);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/users");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/registrations");
  });

  it("normalizes the confirmation (trim + case-insensitive) before delegating", async () => {
    mockDeleteAccountPermanently.mockResolvedValue({ success: true });

    const result = await deleteAccountPermanentlyAction({
      userId: TARGET_USER,
      confirmation: "  eliminar  ",
    });

    expect(result).toEqual({ success: true });
    expect(mockDeleteAccountPermanently).toHaveBeenCalledWith(TARGET_USER);
  });

  it("rejects a confirmation that is not ELIMINAR without calling the service", async () => {
    const result = await deleteAccountPermanentlyAction({
      userId: TARGET_USER,
      confirmation: "confirmo la eliminacion",
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("ELIMINAR");
    expect(mockDeleteAccountPermanently).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("rejects a non-uuid user id without calling the service", async () => {
    const result = await deleteAccountPermanentlyAction({
      userId: "not-a-uuid",
      confirmation: "ELIMINAR",
    });

    expect(result.success).toBe(false);
    expect(mockDeleteAccountPermanently).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("propagates a service failure without revalidating", async () => {
    mockDeleteAccountPermanently.mockResolvedValue({ success: false, error: "boom" });

    const result = await deleteAccountPermanentlyAction({
      userId: TARGET_USER,
      confirmation: "ELIMINAR",
    });

    expect(result).toEqual({ success: false, error: "boom" });
    expect(mockDeleteAccountPermanently).toHaveBeenCalledWith(TARGET_USER);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("returns a typed error instead of throwing when the service throws (e.g. unauthenticated)", async () => {
    // requireAuthenticatedProfile() inside the service throws when there is
    // no session; the action must catch it and reply with a typed result.
    mockDeleteAccountPermanently.mockRejectedValue(new Error("Se requiere autenticación."));

    const result = await deleteAccountPermanentlyAction({
      userId: TARGET_USER,
      confirmation: "ELIMINAR",
    });

    expect(result).toEqual({ success: false, error: "Se requiere autenticación." });
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });
});
