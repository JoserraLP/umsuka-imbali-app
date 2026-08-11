import { describe, it, expect } from "vitest";
import {
  canViewMembers,
  resolveMemberScope,
  canViewMemberDetail,
  isLeadOfGroup,
  type MemberActor,
} from "@/lib/members/authorization";
import { AuthorizationError } from "@/lib/auth/permissions";
import { MANAGEMENT_ROLES, APP_ROLES } from "@/lib/auth/roles";
import type { AppRole, Workgroup } from "@/types/database.types";

function actor(overrides: Partial<MemberActor>): MemberActor {
  return {
    role: "member",
    isWorkgroupLead: false,
    workgroup: "ninguno",
    ...overrides,
  };
}

const ALL_WORKGROUPS: readonly Workgroup[] = ["telas", "barra", "estandarte", "limpieza", "ninguno"];

describe("canViewMembers", () => {
  it("returns true for every management role", () => {
    for (const role of MANAGEMENT_ROLES) {
      expect(canViewMembers(actor({ role }))).toBe(true);
    }
  });

  it("returns true for a workgroup lead of a real group", () => {
    expect(canViewMembers(actor({ isWorkgroupLead: true, workgroup: "telas" }))).toBe(true);
    expect(canViewMembers(actor({ isWorkgroupLead: true, workgroup: "barra" }))).toBe(true);
  });

  it("returns false for plain members and guests", () => {
    for (const role of ["member", "guest"] as const) {
      expect(canViewMembers(actor({ role }))).toBe(false);
    }
  });

  it("returns false for a lead whose workgroup is ninguno (treated as non-lead)", () => {
    expect(canViewMembers(actor({ isWorkgroupLead: true, workgroup: "ninguno" }))).toBe(false);
  });

  it("returns false for null or undefined actors", () => {
    expect(canViewMembers(null)).toBe(false);
    expect(canViewMembers(undefined)).toBe(false);
  });

  it("returns true for a management role that is also a lead (management wins)", () => {
    expect(canViewMembers(actor({ role: "admin", isWorkgroupLead: true, workgroup: "telas" }))).toBe(
      true,
    );
  });
});

describe("resolveMemberScope", () => {
  it("resolves to { kind: 'all' } for every management role", () => {
    for (const role of MANAGEMENT_ROLES) {
      expect(resolveMemberScope(actor({ role }))).toEqual({ kind: "all" });
    }
  });

  it("resolves to the actor's own workgroup for a lead", () => {
    const lead = actor({ isWorkgroupLead: true, workgroup: "telas" });
    expect(resolveMemberScope(lead)).toEqual({ kind: "workgroup", workgroup: "telas" });
  });

  it("always derives the workgroup from the actor, never from input", () => {
    const lead = actor({ isWorkgroupLead: true, workgroup: "barra" });
    expect(resolveMemberScope(lead)).toEqual({ kind: "workgroup", workgroup: "barra" });
  });

  it("throws AuthorizationError for members and guests", () => {
    for (const role of ["member", "guest"] as const) {
      expect(() => resolveMemberScope(actor({ role }))).toThrow(AuthorizationError);
    }
  });

  it("throws AuthorizationError for null actors", () => {
    expect(() => resolveMemberScope(null)).toThrow(AuthorizationError);
    expect(() => resolveMemberScope(undefined)).toThrow(AuthorizationError);
  });

  it("throws AuthorizationError for a lead with workgroup ninguno", () => {
    expect(() => resolveMemberScope(actor({ isWorkgroupLead: true, workgroup: "ninguno" }))).toThrow(
      AuthorizationError,
    );
  });

  it("resolves to 'all' for a lead who is also management", () => {
    expect(resolveMemberScope(actor({ role: "event_manager", isWorkgroupLead: true }))).toEqual({
      kind: "all",
    });
  });
});

describe("canViewMemberDetail", () => {
  it("returns true for management for any target workgroup", () => {
    for (const role of MANAGEMENT_ROLES) {
      for (const workgroup of ALL_WORKGROUPS) {
        expect(canViewMemberDetail(actor({ role }), workgroup)).toBe(true);
      }
    }
  });

  it("allows a lead to view members of their own workgroup only", () => {
    const lead = actor({ isWorkgroupLead: true, workgroup: "telas" });
    expect(canViewMemberDetail(lead, "telas")).toBe(true);
    expect(canViewMemberDetail(lead, "barra")).toBe(false);
    expect(canViewMemberDetail(lead, "ninguno")).toBe(false);
  });

  it("denies members, guests and null actors", () => {
    for (const role of ["member", "guest"] as const) {
      expect(canViewMemberDetail(actor({ role }), "telas")).toBe(false);
    }
    expect(canViewMemberDetail(null, "telas")).toBe(false);
    expect(canViewMemberDetail(undefined, "telas")).toBe(false);
  });

  it("denies a lead whose workgroup is ninguno", () => {
    const lead = actor({ isWorkgroupLead: true, workgroup: "ninguno" });
    expect(canViewMemberDetail(lead, "ninguno")).toBe(false);
    expect(canViewMemberDetail(lead, "telas")).toBe(false);
  });

  it("allows management leads to view any workgroup", () => {
    const adminLead = actor({ role: "admin", isWorkgroupLead: true, workgroup: "telas" });
    expect(canViewMemberDetail(adminLead, "barra")).toBe(true);
  });
});

describe("isLeadOfGroup", () => {
  it("returns true only when the actor is the lead of the given group", () => {
    const lead = actor({ isWorkgroupLead: true, workgroup: "telas" });
    expect(isLeadOfGroup(lead, "telas")).toBe(true);
    expect(isLeadOfGroup(lead, "barra")).toBe(false);
  });

  it("returns false for non-leads and null actors", () => {
    expect(isLeadOfGroup(actor({ workgroup: "telas" }), "telas")).toBe(false);
    expect(isLeadOfGroup(null, "telas")).toBe(false);
    expect(isLeadOfGroup(undefined, "telas")).toBe(false);
  });

  it("returns false for a lead with workgroup ninguno even when asked for ninguno", () => {
    const lead = actor({ isWorkgroupLead: true, workgroup: "ninguno" });
    expect(isLeadOfGroup(lead, "ninguno")).toBe(false);
  });

  it("returns false for a management lead of another group", () => {
    const adminLead = actor({ role: "super_admin", isWorkgroupLead: true, workgroup: "telas" });
    expect(isLeadOfGroup(adminLead, "barra")).toBe(false);
  });

  it("covers every AppRole without throwing", () => {
    for (const role of APP_ROLES as readonly AppRole[]) {
      expect(() => isLeadOfGroup(actor({ role }), "telas")).not.toThrow();
    }
  });
});
