import { describe, expect, it } from "vitest";
import { canAssignRole } from "@/lib/auth/permissions";

describe("canAssignRole", () => {
  it("allows super_admin to assign any role, including super_admin and admin", () => {
    expect(canAssignRole("super_admin", "super_admin")).toBe(true);
    expect(canAssignRole("super_admin", "admin")).toBe(true);
    expect(canAssignRole("super_admin", "board_member")).toBe(true);
    expect(canAssignRole("super_admin", "guest")).toBe(true);
  });

  it("allows admin to assign non-privileged roles", () => {
    expect(canAssignRole("admin", "board_member")).toBe(true);
    expect(canAssignRole("admin", "event_manager")).toBe(true);
    expect(canAssignRole("admin", "member")).toBe(true);
    expect(canAssignRole("admin", "guest")).toBe(true);
  });

  it("prevents admin from granting or revoking super_admin/admin (privilege escalation)", () => {
    expect(canAssignRole("admin", "super_admin")).toBe(false);
    expect(canAssignRole("admin", "admin")).toBe(false);
  });

  it("denies role assignment to non-admin actors entirely", () => {
    expect(canAssignRole("board_member", "member")).toBe(false);
    expect(canAssignRole("event_manager", "guest")).toBe(false);
    expect(canAssignRole("member", "guest")).toBe(false);
    expect(canAssignRole("guest", "member")).toBe(false);
  });

  it("denies role assignment when the actor role is missing", () => {
    expect(canAssignRole(null, "member")).toBe(false);
    expect(canAssignRole(undefined, "member")).toBe(false);
  });
});
