import { describe, expect, it } from "vitest";
import {
  AuthorizationError,
  can,
  requireAdmin,
  requireManagement,
  requireRole,
} from "@/lib/auth/permissions";
import { ADMIN_ROLES, MANAGEMENT_ROLES } from "@/lib/auth/roles";

describe("permissions", () => {
  describe("requireRole", () => {
    it("does not throw when the role is allowed", () => {
      expect(() => requireRole("admin", ["admin", "super_admin"])).not.toThrow();
    });

    it("throws AuthorizationError when the role is not allowed", () => {
      expect(() => requireRole("member", ["admin", "super_admin"])).toThrow(AuthorizationError);
    });

    it("throws AuthorizationError when the role is null or undefined", () => {
      expect(() => requireRole(null, ["admin"])).toThrow(AuthorizationError);
      expect(() => requireRole(undefined, ["admin"])).toThrow(AuthorizationError);
    });
  });

  describe("requireAdmin", () => {
    it("allows every admin role", () => {
      for (const role of ADMIN_ROLES) {
        expect(() => requireAdmin(role)).not.toThrow();
      }
    });

    it("rejects non-admin roles", () => {
      expect(() => requireAdmin("board_member")).toThrow(AuthorizationError);
      expect(() => requireAdmin("guest")).toThrow(AuthorizationError);
    });
  });

  describe("requireManagement", () => {
    it("allows every management role", () => {
      for (const role of MANAGEMENT_ROLES) {
        expect(() => requireManagement(role)).not.toThrow();
      }
    });

    it("rejects member and guest", () => {
      expect(() => requireManagement("member")).toThrow(AuthorizationError);
      expect(() => requireManagement("guest")).toThrow(AuthorizationError);
    });
  });

  describe("can", () => {
    it("returns a boolean instead of throwing", () => {
      expect(can("admin", ["admin"])).toBe(true);
      expect(can("member", ["admin"])).toBe(false);
      expect(can(null, ["admin"])).toBe(false);
    });
  });
});
