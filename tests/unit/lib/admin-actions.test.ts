import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by vitest) ──────────────────────────

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
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
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import {
  updateSetting,
  approveUser,
  suspendUser,
  updateUserRole,
  setUserActive,
  logAuditAction,
} from "@/lib/admin/mutations";
import {
  updateMemberProfile,
  updateMemberComponentType,
  updateMemberWorkgroup,
} from "@/lib/profiles/mutations";
import { createEmaillessAccount } from "@/lib/auth/admin-create";
import { generateResetToken, adminUnlockAccount } from "@/lib/auth/password-service";
import {
  updateSettingAction,
  approveUserActionAdmin,
  suspendUserActionAdmin,
} from "@/app/admin/actions";
import {
  updateMemberRoleAction,
  setMemberActiveAction,
  updateMemberProfileAction,
  updateMemberComponentTypeAction,
  updateMemberWorkgroupAction,
  setComponentLeadAction,
  createEmaillessAccountAction,
  generateResetTokenAction,
  unlockAccountAction,
} from "@/app/admin/users/actions";
import { approveUserAction, suspendUserAction } from "@/app/admin/registrations/actions";
import type { AuthenticatedProfile } from "@/types/auth";
import type { AdminAuditAction } from "@/lib/admin/schema";
import type { UpdateMemberProfileInput } from "@/lib/profiles/schema";

const mockUpdateSetting = vi.mocked(updateSetting);
const mockApproveUser = vi.mocked(approveUser);
const mockSuspendUser = vi.mocked(suspendUser);
const mockUpdateUserRole = vi.mocked(updateUserRole);
const mockSetUserActive = vi.mocked(setUserActive);
const mockLogAuditAction = vi.mocked(logAuditAction);
const mockUpdateMemberProfile = vi.mocked(updateMemberProfile);
const mockUpdateMemberComponentType = vi.mocked(updateMemberComponentType);
const mockUpdateMemberWorkgroup = vi.mocked(updateMemberWorkgroup);
const mockCreateEmaillessAccount = vi.mocked(createEmaillessAccount);
const mockGenerateResetToken = vi.mocked(generateResetToken);
const mockAdminUnlockAccount = vi.mocked(adminUnlockAccount);
const mockRevalidatePath = vi.mocked(revalidatePath);
const mockRequireAuthenticatedProfile = vi.mocked(requireAuthenticatedProfile);

const ACTOR_ID = "123e4567-e89b-12d3-a456-426614174000";
const TARGET_USER = "323e4567-e89b-12d3-a456-426614174000";

function superAdmin(): AuthenticatedProfile {
  return {
    id: ACTOR_ID,
    firstName: "Ada",
    lastName: "Lovelace",
    email: "ada@umsuka.org",
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
    bio: null,
    phone: null,
    skills: [],
    joinedAt: null,
    createdAt: "2026-01-01T00:00:00.000Z",
  };
}

// Chain builder for setComponentLeadAction's target read + update.
function makeProfilesMock(selectError?: Error) {
  const thenableUpdate = Promise.resolve({ data: null, error: null });
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() =>
      Promise.resolve(
        selectError
          ? { data: null, error: selectError }
          : { data: { id: TARGET_USER, status: "active", is_active: true }, error: null },
      ),
    ),
    update: vi.fn(() => builder),
    then: thenableUpdate.then.bind(thenableUpdate),
    catch: thenableUpdate.catch.bind(thenableUpdate),
    finally: thenableUpdate.finally.bind(thenableUpdate),
  };
  return builder;
}

function profileEditInput(overrides: Partial<UpdateMemberProfileInput> = {}): UpdateMemberProfileInput {
  return {
    userId: TARGET_USER,
    firstName: "Ada",
    lastName: "Lovelace",
    birthDate: null,
    componentType: "member",
    bio: null,
    phone: null,
    skills: [],
    avatarUrl: null,
    joinedAt: null,
    ...overrides,
  };
}

/**
 * Simulates the real wrapper contract: the lib delegation writes exactly
 * one audit row through logAuditAction before reporting success — the
 * action layer must NOT add a second one.
 */
function auditOnce(action: AdminAuditAction) {
  return vi.fn(async (input: { userId: string }) => {
    await mockLogAuditAction({
      actorId: ACTOR_ID,
      action,
      entityType: "profile",
      entityId: input.userId,
    });
    return { success: true };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockRequireAuthenticatedProfile.mockResolvedValue(superAdmin());
});

// ── /admin/actions.ts ───────────────────────────────────

describe("admin panel actions", () => {
  it("updateSettingAction delegates and revalidates /admin/settings on success", async () => {
    mockUpdateSetting.mockResolvedValue({ success: true });

    const result = await updateSettingAction({ key: "app_name", value: "Umsuka" });

    expect(result).toEqual({ success: true });
    expect(mockUpdateSetting).toHaveBeenCalledWith({ key: "app_name", value: "Umsuka" });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/settings");
  });

  it("updateSettingAction does not revalidate when the mutation fails", async () => {
    mockUpdateSetting.mockResolvedValue({ success: false, error: "boom" });

    const result = await updateSettingAction({ key: "app_name", value: "Umsuka" });

    expect(result.success).toBe(false);
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("approveUserActionAdmin delegates to the admin wrapper and triggers exactly 1 audit", async () => {
    mockApproveUser.mockImplementation(auditOnce("user.approved"));

    const result = await approveUserActionAdmin({ userId: TARGET_USER });

    expect(result).toEqual({ success: true });
    expect(mockApproveUser).toHaveBeenCalledWith({ userId: TARGET_USER });
    expect(mockLogAuditAction).toHaveBeenCalledTimes(1);
    expect(mockLogAuditAction).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      action: "user.approved",
      entityType: "profile",
      entityId: TARGET_USER,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/users");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/registrations");
  });

  it("approveUserActionAdmin produces no audit when the mutation fails", async () => {
    mockApproveUser.mockResolvedValue({ success: false, error: "boom" });

    await approveUserActionAdmin({ userId: TARGET_USER });

    expect(mockLogAuditAction).not.toHaveBeenCalled();
    expect(mockRevalidatePath).not.toHaveBeenCalled();
  });

  it("suspendUserActionAdmin delegates to the admin wrapper and triggers exactly 1 audit", async () => {
    mockSuspendUser.mockImplementation(auditOnce("user.suspended"));

    const result = await suspendUserActionAdmin({ userId: TARGET_USER });

    expect(result).toEqual({ success: true });
    expect(mockSuspendUser).toHaveBeenCalledWith({ userId: TARGET_USER });
    expect(mockLogAuditAction).toHaveBeenCalledTimes(1);
    expect(mockLogAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.suspended", entityId: TARGET_USER }),
    );
  });
});

// ── /admin/users/actions.ts ─────────────────────────────

describe("users actions audit wiring", () => {
  it("updateMemberRoleAction delegates to the admin wrapper WITHOUT its own audit (no duplicates)", async () => {
    mockUpdateUserRole.mockImplementation(auditOnce("user.role_changed"));

    const result = await updateMemberRoleAction({ userId: TARGET_USER, role: "admin" });

    expect(result).toEqual({ success: true });
    expect(mockUpdateUserRole).toHaveBeenCalledWith({ userId: TARGET_USER, role: "admin" });
    expect(mockLogAuditAction).toHaveBeenCalledTimes(1);
    expect(mockLogAuditAction).toHaveBeenCalledWith(
      expect.objectContaining({ action: "user.role_changed" }),
    );
  });

  it("setMemberActiveAction delegates to the admin wrapper WITHOUT its own audit (no duplicates)", async () => {
    mockSetUserActive.mockImplementation(auditOnce("user.activated"));

    const result = await setMemberActiveAction({ userId: TARGET_USER, isActive: true });

    expect(result).toEqual({ success: true });
    expect(mockSetUserActive).toHaveBeenCalledWith({ userId: TARGET_USER, isActive: true });
    expect(mockLogAuditAction).toHaveBeenCalledTimes(1);
  });

  it("updateMemberProfileAction audits user.profile_updated once after success", async () => {
    mockUpdateMemberProfile.mockResolvedValue({ success: true });

    const result = await updateMemberProfileAction(profileEditInput());

    expect(result).toEqual({ success: true });
    expect(mockLogAuditAction).toHaveBeenCalledTimes(1);
    expect(mockLogAuditAction).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      action: "user.profile_updated",
      entityType: "profile",
      entityId: TARGET_USER,
      details: null,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/users");
    expect(mockRevalidatePath).toHaveBeenCalledWith(`/admin/users/${TARGET_USER}`);
  });

  it("updateMemberProfileAction does not audit when the mutation fails", async () => {
    mockUpdateMemberProfile.mockResolvedValue({ success: false, error: "boom" });

    await updateMemberProfileAction(profileEditInput());

    expect(mockLogAuditAction).not.toHaveBeenCalled();
  });

  it("updateMemberComponentTypeAction audits user.component_type_changed once", async () => {
    mockUpdateMemberComponentType.mockResolvedValue({ success: true });

    await updateMemberComponentTypeAction({ userId: TARGET_USER, componentType: "music" });

    expect(mockLogAuditAction).toHaveBeenCalledTimes(1);
    expect(mockLogAuditAction).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      action: "user.component_type_changed",
      entityType: "profile",
      entityId: TARGET_USER,
      details: null,
    });
  });

  it("updateMemberWorkgroupAction audits user.workgroup_changed once", async () => {
    mockUpdateMemberWorkgroup.mockResolvedValue({ success: true });

    await updateMemberWorkgroupAction({ userId: TARGET_USER, workgroup: "telas" });

    expect(mockLogAuditAction).toHaveBeenCalledTimes(1);
    expect(mockLogAuditAction).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      action: "user.workgroup_changed",
      entityType: "profile",
      entityId: TARGET_USER,
      details: null,
    });
  });

  it("setComponentLeadAction audits user.component_lead_changed once (reusing the resolved actor)", async () => {
    const mockFrom = vi.fn();
    vi.mocked(createClient).mockReturnValue({
      from: mockFrom,
    } as unknown as ReturnType<typeof createClient>);
    mockFrom.mockReturnValue(makeProfilesMock());

    const result = await setComponentLeadAction(TARGET_USER, "music");

    expect(result).toEqual({ success: true });
    expect(mockLogAuditAction).toHaveBeenCalledTimes(1);
    expect(mockLogAuditAction).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      action: "user.component_lead_changed",
      entityType: "profile",
      entityId: TARGET_USER,
      details: { component: "music" },
    });
  });

  it("setComponentLeadAction does not audit on failure", async () => {
    const mockFrom = vi.fn();
    vi.mocked(createClient).mockReturnValue({
      from: mockFrom,
    } as unknown as ReturnType<typeof createClient>);
    mockFrom.mockReturnValue(makeProfilesMock(new Error("boom")));

    const result = await setComponentLeadAction(TARGET_USER, "music");

    expect(result.success).toBe(false);
    expect(mockLogAuditAction).not.toHaveBeenCalled();
  });

  it("createEmaillessAccountAction audits user.emailless_created once with the username", async () => {
    mockCreateEmaillessAccount.mockResolvedValue({
      success: true,
      credentials: { username: "messi12", password: "Test1234!" },
    });

    const result = await createEmaillessAccountAction({
      firstName: "Lionel",
      lastName: "Messi",
      username: "messi12",
      password: "Test1234!",
      componentType: "member",
    });

    expect(result.success).toBe(true);
    expect(mockLogAuditAction).toHaveBeenCalledTimes(1);
    expect(mockLogAuditAction).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      action: "user.emailless_created",
      entityType: "auth.user",
      entityId: null,
      details: { username: "messi12" },
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/users");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/registrations");
  });

  it("createEmaillessAccountAction does not audit on failure", async () => {
    mockCreateEmaillessAccount.mockResolvedValue({ success: false, error: "boom" });

    await createEmaillessAccountAction({
      firstName: "Lionel",
      lastName: "Messi",
      username: "messi12",
      password: "Test1234!",
      componentType: "member",
    });

    expect(mockLogAuditAction).not.toHaveBeenCalled();
  });

  it("generateResetTokenAction audits user.password_reset_generated once with the profile id", async () => {
    mockGenerateResetToken.mockResolvedValue({ success: true, token: "t1", expiresAt: "x" });

    const result = await generateResetTokenAction({ profileId: TARGET_USER });

    expect(result.success).toBe(true);
    expect(mockLogAuditAction).toHaveBeenCalledTimes(1);
    expect(mockLogAuditAction).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      action: "user.password_reset_generated",
      entityType: "profile",
      entityId: TARGET_USER,
      details: null,
    });
  });

  it("unlockAccountAction audits user.account_unlocked once with the profile id", async () => {
    mockAdminUnlockAccount.mockResolvedValue({ success: true });

    const result = await unlockAccountAction(TARGET_USER);

    expect(result.success).toBe(true);
    expect(mockLogAuditAction).toHaveBeenCalledTimes(1);
    expect(mockLogAuditAction).toHaveBeenCalledWith({
      actorId: ACTOR_ID,
      action: "user.account_unlocked",
      entityType: "profile",
      entityId: TARGET_USER,
      details: null,
    });
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/users");
  });

  it("unlockAccountAction does not audit on failure", async () => {
    mockAdminUnlockAccount.mockResolvedValue({ success: false, error: "boom" });

    await unlockAccountAction(TARGET_USER);

    expect(mockLogAuditAction).not.toHaveBeenCalled();
  });

  it("an audit failure never turns a successful action into a failure", async () => {
    mockUpdateMemberProfile.mockResolvedValue({ success: true });
    mockRequireAuthenticatedProfile.mockRejectedValue(new Error("sin sesión"));

    const result = await updateMemberProfileAction(profileEditInput());

    expect(result).toEqual({ success: true });
  });
});

// ── /admin/registrations/actions.ts ─────────────────────

describe("registrations actions audit wiring", () => {
  it("approveUserAction delegates to the admin wrapper WITHOUT its own audit", async () => {
    mockApproveUser.mockImplementation(auditOnce("user.approved"));

    const result = await approveUserAction({ userId: TARGET_USER });

    expect(result).toEqual({ success: true });
    expect(mockApproveUser).toHaveBeenCalledWith({ userId: TARGET_USER });
    expect(mockLogAuditAction).toHaveBeenCalledTimes(1);
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/registrations");
    expect(mockRevalidatePath).toHaveBeenCalledWith("/admin/users");
  });

  it("approveUserAction does not audit when the mutation fails", async () => {
    mockApproveUser.mockResolvedValue({ success: false, error: "boom" });

    await approveUserAction({ userId: TARGET_USER });

    expect(mockLogAuditAction).not.toHaveBeenCalled();
  });

  it("suspendUserAction delegates to the admin wrapper WITHOUT its own audit", async () => {
    mockSuspendUser.mockImplementation(auditOnce("user.suspended"));

    const result = await suspendUserAction({ userId: TARGET_USER });

    expect(result).toEqual({ success: true });
    expect(mockSuspendUser).toHaveBeenCalledWith({ userId: TARGET_USER });
    expect(mockLogAuditAction).toHaveBeenCalledTimes(1);
  });
});