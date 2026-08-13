import { describe, it, expect } from "vitest";
import {
  canViewMembers,
  resolveMemberScope,
  canViewMemberDetail,
  isLeadOfGroup,
  isLeadOfComponent,
  type MemberActor,
} from "@/lib/members/authorization";
import { AuthorizationError } from "@/lib/auth/permissions";
import { MANAGEMENT_ROLES, APP_ROLES } from "@/lib/auth/roles";
import type { AppRole, ComponentType, Workgroup } from "@/types/database.types";

function actor(overrides: Partial<MemberActor>): MemberActor {
  return {
    role: "member",
    isWorkgroupLead: false,
    workgroup: "ninguno",
    componentLeadFor: null,
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

  it("returns true for a component lead (music or dance)", () => {
    expect(canViewMembers(actor({ componentLeadFor: "music" }))).toBe(true);
    expect(canViewMembers(actor({ componentLeadFor: "dance" }))).toBe(true);
  });

  it("returns false for plain members and guests", () => {
    for (const role of ["member", "guest"] as const) {
      expect(canViewMembers(actor({ role }))).toBe(false);
    }
  });

  it("returns false for a lead whose workgroup is ninguno (treated as non-lead)", () => {
    expect(canViewMembers(actor({ isWorkgroupLead: true, workgroup: "ninguno" }))).toBe(false);
  });

  it("returns false for a member with componentLeadFor null", () => {
    expect(canViewMembers(actor({ componentLeadFor: null }))).toBe(false);
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

  it("returns true for a component lead that is also a member", () => {
    expect(canViewMembers(actor({ componentLeadFor: "dance" }))).toBe(true);
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

  it("resolves to { kind: 'component', component } for a component lead", () => {
    expect(resolveMemberScope(actor({ componentLeadFor: "music" }))).toEqual({
      kind: "component",
      component: "music",
    });
    expect(resolveMemberScope(actor({ componentLeadFor: "dance" }))).toEqual({
      kind: "component",
      component: "dance",
    });
  });

  it("resolves to 'all' for management even when componentLeadFor is set (management wins)", () => {
    expect(
      resolveMemberScope(actor({ role: "board_member", componentLeadFor: "music" })),
    ).toEqual({ kind: "all" });
  });

  it("resolves to the component scope when the actor is both workgroup lead and component lead (component wins)", () => {
    const both = actor({ isWorkgroupLead: true, workgroup: "telas", componentLeadFor: "music" });
    expect(resolveMemberScope(both)).toEqual({ kind: "component", component: "music" });
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

  it("throws AuthorizationError for a non-lead member with componentLeadFor null", () => {
    expect(() => resolveMemberScope(actor({ componentLeadFor: null }))).toThrow(
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
  it("returns true for management for any target workgroup and component", () => {
    for (const role of MANAGEMENT_ROLES) {
      for (const workgroup of ALL_WORKGROUPS) {
        expect(canViewMemberDetail(actor({ role }), { workgroup, componentType: "music" })).toBe(
          true,
        );
        expect(canViewMemberDetail(actor({ role }), { workgroup, componentType: "dance" })).toBe(
          true,
        );
        expect(canViewMemberDetail(actor({ role }), { workgroup, componentType: "member" })).toBe(
          true,
        );
      }
    }
  });

  it("allows a lead to view members of their own workgroup only", () => {
    const lead = actor({ isWorkgroupLead: true, workgroup: "telas" });
    expect(canViewMemberDetail(lead, { workgroup: "telas", componentType: "music" })).toBe(true);
    expect(canViewMemberDetail(lead, { workgroup: "barra", componentType: "music" })).toBe(false);
    expect(canViewMemberDetail(lead, { workgroup: "ninguno", componentType: "music" })).toBe(false);
  });

  it("allows a component lead to view members of their component only, any workgroup", () => {
    const musicLead = actor({ componentLeadFor: "music" });
    expect(canViewMemberDetail(musicLead, { workgroup: "barra", componentType: "music" })).toBe(
      true,
    );
    expect(canViewMemberDetail(musicLead, { workgroup: "telas", componentType: "music" })).toBe(
      true,
    );
    expect(canViewMemberDetail(musicLead, { workgroup: "barra", componentType: "dance" })).toBe(
      false,
    );
    expect(canViewMemberDetail(musicLead, { workgroup: "barra", componentType: "member" })).toBe(
      false,
    );
  });

  it("gives the component scope precedence for an actor who is both workgroup and component lead", () => {
    const both = actor({ isWorkgroupLead: true, workgroup: "telas", componentLeadFor: "music" });
    // Same workgroup but wrong component → denied (component check comes first).
    expect(canViewMemberDetail(both, { workgroup: "telas", componentType: "dance" })).toBe(false);
    expect(canViewMemberDetail(both, { workgroup: "barra", componentType: "music" })).toBe(true);
  });

  it("denies members, guests and null actors", () => {
    for (const role of ["member", "guest"] as const) {
      expect(
        canViewMemberDetail(actor({ role }), { workgroup: "telas", componentType: "music" }),
      ).toBe(false);
    }
    expect(
      canViewMemberDetail(null, { workgroup: "telas", componentType: "music" }),
    ).toBe(false);
    expect(
      canViewMemberDetail(undefined, { workgroup: "telas", componentType: "music" }),
    ).toBe(false);
  });

  it("denies a lead whose workgroup is ninguno", () => {
    const lead = actor({ isWorkgroupLead: true, workgroup: "ninguno" });
    expect(canViewMemberDetail(lead, { workgroup: "ninguno", componentType: "music" })).toBe(false);
    expect(canViewMemberDetail(lead, { workgroup: "telas", componentType: "music" })).toBe(false);
  });

  it("allows management leads to view any workgroup", () => {
    const adminLead = actor({ role: "admin", isWorkgroupLead: true, workgroup: "telas" });
    expect(canViewMemberDetail(adminLead, { workgroup: "barra", componentType: "dance" })).toBe(
      true,
    );
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

describe("isLeadOfComponent", () => {
  it("returns true only when the actor leads the exact component", () => {
    const musicLead = actor({ componentLeadFor: "music" });
    expect(isLeadOfComponent(musicLead, "music" as ComponentType)).toBe(true);
    expect(isLeadOfComponent(musicLead, "dance" as ComponentType)).toBe(false);
  });

  it("returns false for actors without a component lead", () => {
    const plain = actor({});
    expect(isLeadOfComponent(plain, "music" as ComponentType)).toBe(false);
    expect(isLeadOfComponent(plain, "dance" as ComponentType)).toBe(false);
  });

  it("returns false for null or undefined actors", () => {
    expect(isLeadOfComponent(null, "music" as ComponentType)).toBe(false);
    expect(isLeadOfComponent(undefined, "music" as ComponentType)).toBe(false);
  });

  it("returns false when componentLeadFor is null even for a management actor", () => {
    const admin = actor({ role: "super_admin", componentLeadFor: null });
    expect(isLeadOfComponent(admin, "music" as ComponentType)).toBe(false);
  });
});
