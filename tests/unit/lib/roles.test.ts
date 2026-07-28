import { describe, expect, it } from "vitest";
import {
  ADMIN_ROLES,
  APP_ROLES,
  DEFAULT_ROLE,
  hasAtLeastRole,
  isAdminRole,
  isManagementRole,
  isValidRole,
  roleRank,
} from "@/lib/auth/roles";

describe("roles", () => {
  it("lists every role defined by the RBAC model", () => {
    expect(APP_ROLES).toEqual([
      "super_admin",
      "admin",
      "board_member",
      "event_manager",
      "member",
      "guest",
    ]);
  });

  it("defaults new members to the member role", () => {
    expect(DEFAULT_ROLE).toBe("member");
  });

  describe("isValidRole", () => {
    it("accepts every known role", () => {
      for (const role of APP_ROLES) {
        expect(isValidRole(role)).toBe(true);
      }
    });

    it("rejects unknown strings", () => {
      expect(isValidRole("superuser")).toBe(false);
      expect(isValidRole("")).toBe(false);
    });
  });

  describe("isAdminRole", () => {
    it("is true only for super_admin and admin", () => {
      expect(isAdminRole("super_admin")).toBe(true);
      expect(isAdminRole("admin")).toBe(true);
      expect(isAdminRole("board_member")).toBe(false);
      expect(isAdminRole("member")).toBe(false);
      expect(isAdminRole("guest")).toBe(false);
    });
  });

  describe("isManagementRole", () => {
    it("includes all operational roles", () => {
      for (const role of ADMIN_ROLES) {
        expect(isManagementRole(role)).toBe(true);
      }
      expect(isManagementRole("board_member")).toBe(true);
      expect(isManagementRole("event_manager")).toBe(true);
      expect(isManagementRole("member")).toBe(false);
      expect(isManagementRole("guest")).toBe(false);
    });
  });

  describe("roleRank", () => {
    it("ranks super_admin highest and guest lowest", () => {
      expect(roleRank("super_admin")).toBeLessThan(roleRank("admin"));
      expect(roleRank("admin")).toBeLessThan(roleRank("board_member"));
      expect(roleRank("board_member")).toBeLessThan(roleRank("event_manager"));
      expect(roleRank("event_manager")).toBeLessThan(roleRank("member"));
      expect(roleRank("member")).toBeLessThan(roleRank("guest"));
    });
  });

  describe("hasAtLeastRole", () => {
    it("returns true when the role meets or exceeds the minimum", () => {
      expect(hasAtLeastRole("admin", "board_member")).toBe(true);
      expect(hasAtLeastRole("board_member", "board_member")).toBe(true);
    });

    it("returns false when the role is below the minimum", () => {
      expect(hasAtLeastRole("member", "board_member")).toBe(false);
      expect(hasAtLeastRole("guest", "event_manager")).toBe(false);
    });
  });
});
