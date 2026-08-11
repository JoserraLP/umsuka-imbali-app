import { describe, it, expect } from "vitest";
import { canAssignToShift } from "@/lib/shifts/assignments";
import type { ActorAuthContext, ShiftAuthContext, EventAuthContext } from "@/lib/shifts/assignments";

function lead(overrides: Partial<ActorAuthContext> = {}): ActorAuthContext {
  return {
    id: "lead-1",
    isWorkgroupLead: true,
    workgroup: "barra",
    role: "member",
    ...overrides,
  };
}

const ownShift: ShiftAuthContext = { eventId: "event-1", workgroup: "barra" };
const ownEvent: EventAuthContext = { eventType: "work_shift", createdBy: "lead-1" };

// ──────────────────────────────────────────────────────
// canAssignToShift — mirrors the shift_assignments RLS policy
// ──────────────────────────────────────────────────────

describe("canAssignToShift", () => {
  it("allows management to assign to any shift", () => {
    const admin = lead({ isWorkgroupLead: false, role: "super_admin", workgroup: "ninguno" });
    expect(canAssignToShift(admin, ownShift, ownEvent)).toBe(true);
    expect(canAssignToShift(admin, { eventId: "e2", workgroup: null }, { eventType: "general", createdBy: "someone" })).toBe(true);
    expect(canAssignToShift(admin, null, null)).toBe(true);
  });

  it("allows the lead of the shift's group on their own work_shift event", () => {
    expect(canAssignToShift(lead(), ownShift, ownEvent)).toBe(true);
  });

  it("allows the lead on their own event even when the shift has no workgroup filter", () => {
    expect(canAssignToShift(lead(), { eventId: "event-1", workgroup: null }, ownEvent)).toBe(true);
  });

  it("blocks a lead from assigning to shifts of other groups", () => {
    const telasShift: ShiftAuthContext = { eventId: "event-1", workgroup: "telas" };
    expect(canAssignToShift(lead(), telasShift, ownEvent)).toBe(false);
  });

  it("blocks a lead from assigning to events they did not create", () => {
    const foreignEvent: EventAuthContext = { eventType: "work_shift", createdBy: "other-lead" };
    expect(canAssignToShift(lead(), ownShift, foreignEvent)).toBe(false);
  });

  it("blocks a lead from assigning to non-work_shift events", () => {
    const generalEvent: EventAuthContext = { eventType: "general", createdBy: "lead-1" };
    expect(canAssignToShift(lead(), ownShift, generalEvent)).toBe(false);
  });

  it("blocks non-lead members even on their own events", () => {
    const member = lead({ isWorkgroupLead: false });
    expect(canAssignToShift(member, ownShift, ownEvent)).toBe(false);
  });

  it("blocks assignment when shift or event is missing", () => {
    expect(canAssignToShift(lead(), null, ownEvent)).toBe(false);
    expect(canAssignToShift(lead(), ownShift, null)).toBe(false);
  });
});
