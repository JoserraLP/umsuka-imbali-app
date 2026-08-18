import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  PERMISSIONS_BY_ROLE,
  permissionsForRole,
  hasPermission,
  requirePermission,
} from "@/lib/admin/permissions";
import { AuthorizationError } from "@/lib/auth/permissions";
import { APP_ROLES } from "@/lib/auth/roles";
import type { Permission } from "@/types/database.types";

const ALL_PERMISSIONS: readonly Permission[] = [
  "users.read",
  "users.manage",
  "settings.read",
  "settings.write",
  "audit.read",
];

// ── Permissions matrix ──────────────────────────────────

describe("PERMISSIONS_BY_ROLE matrix", () => {
  it("grants super_admin every permission", () => {
    expect(PERMISSIONS_BY_ROLE.super_admin).toEqual(ALL_PERMISSIONS);
  });

  it("grants admin every permission", () => {
    expect(PERMISSIONS_BY_ROLE.admin).toEqual(ALL_PERMISSIONS);
  });

  it("grants board_member only users.read", () => {
    expect(PERMISSIONS_BY_ROLE.board_member).toEqual(["users.read"]);
  });

  it("grants event_manager only users.read", () => {
    expect(PERMISSIONS_BY_ROLE.event_manager).toEqual(["users.read"]);
  });

  it("grants member no permissions", () => {
    expect(PERMISSIONS_BY_ROLE.member).toEqual([]);
  });

  it("grants guest no permissions", () => {
    expect(PERMISSIONS_BY_ROLE.guest).toEqual([]);
  });

  it("covers every application role", () => {
    for (const role of APP_ROLES) {
      expect(PERMISSIONS_BY_ROLE[role]).toBeDefined();
    }
  });

  it("uses only valid permission values", () => {
    const valid = new Set<string>(ALL_PERMISSIONS);
    for (const role of APP_ROLES) {
      for (const permission of PERMISSIONS_BY_ROLE[role]) {
        expect(valid.has(permission)).toBe(true);
      }
    }
  });
});

// ── permissionsForRole (fail-closed) ────────────────────

describe("permissionsForRole", () => {
  it("returns [] for unknown roles (fail-closed)", () => {
    expect(permissionsForRole("president")).toEqual([]);
    expect(permissionsForRole("")).toEqual([]);
  });

  it("returns the documented set for known roles", () => {
    expect(permissionsForRole("super_admin")).toEqual(ALL_PERMISSIONS);
    expect(permissionsForRole("board_member")).toEqual(["users.read"]);
  });
});

// ── hasPermission ───────────────────────────────────────

describe("hasPermission", () => {
  it("allows admins to manage users and settings", () => {
    expect(hasPermission("super_admin", "users.manage")).toBe(true);
    expect(hasPermission("admin", "settings.write")).toBe(true);
    expect(hasPermission("admin", "audit.read")).toBe(true);
  });

  it("allows management roles to read the user directory", () => {
    expect(hasPermission("board_member", "users.read")).toBe(true);
    expect(hasPermission("event_manager", "users.read")).toBe(true);
  });

  it("denies management roles everything beyond users.read", () => {
    expect(hasPermission("board_member", "users.manage")).toBe(false);
    expect(hasPermission("event_manager", "settings.read")).toBe(false);
    expect(hasPermission("board_member", "audit.read")).toBe(false);
  });

  it("denies member/guest every permission", () => {
    expect(hasPermission("member", "users.read")).toBe(false);
    expect(hasPermission("guest", "users.read")).toBe(false);
    expect(hasPermission("member", "audit.read")).toBe(false);
  });

  it("denies null/undefined roles (no session)", () => {
    expect(hasPermission(null, "users.read")).toBe(false);
    expect(hasPermission(undefined, "users.read")).toBe(false);
  });
});

// ── requirePermission ───────────────────────────────────

describe("requirePermission", () => {
  it("passes silently when the permission is granted", () => {
    expect(() => requirePermission("admin", "settings.write")).not.toThrow();
    expect(() => requirePermission("super_admin", "audit.read")).not.toThrow();
  });

  it("throws AuthorizationError when the permission is missing", () => {
    expect(() => requirePermission("member", "users.manage")).toThrow(AuthorizationError);
    expect(() => requirePermission("board_member", "settings.read")).toThrow(AuthorizationError);
  });

  it("throws AuthorizationError for a null role", () => {
    expect(() => requirePermission(null, "users.read")).toThrow(AuthorizationError);
  });
});

// ── Sync with the SQL seed (migration 0053) ─────────────

describe("PERMISSIONS_BY_ROLE ↔ SQL seed sync", () => {
  it("matches the role_permissions seed literals of migration 0053", () => {
    const sql = readFileSync(
      join(process.cwd(), "supabase/migrations/20260101005300_admin_panel.sql"),
      "utf8",
    );

    const seeded = new Set<string>();
    for (const match of sql.matchAll(/^\s*\('([a-z_]+)', '([a-z.]+)'\),?$/gm)) {
      seeded.add(`${match[1]}:${match[2]}`);
    }
    expect(seeded.size).toBeGreaterThan(0);

    const expected = new Set<string>();
    for (const role of APP_ROLES) {
      for (const permission of PERMISSIONS_BY_ROLE[role]) {
        expected.add(`${role}:${permission}`);
      }
    }

    expect([...seeded].sort()).toEqual([...expected].sort());
  });
});