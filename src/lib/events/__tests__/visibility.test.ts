import { describe, it, expect } from "vitest";
import { isEventVisibleToGroup } from "@/lib/events/queries";
import type { EventListItem } from "@/lib/events/queries";

function eventWithGroup(visibleToGroup: EventListItem["visibleToGroup"]): Pick<EventListItem, "visibleToGroup"> {
  return { visibleToGroup };
}

// ──────────────────────────────────────────────────────
// isEventVisibleToGroup — mirrors the events SELECT RLS policy
// ──────────────────────────────────────────────────────

describe("isEventVisibleToGroup", () => {
  it("returns true for general events (visible_to_group = null)", () => {
    expect(isEventVisibleToGroup(eventWithGroup(null), "barra")).toBe(true);
    expect(isEventVisibleToGroup(eventWithGroup(null), "ninguno")).toBe(true);
  });

  it("returns true for a member of the target group", () => {
    expect(isEventVisibleToGroup(eventWithGroup("barra"), "barra")).toBe(true);
    expect(isEventVisibleToGroup(eventWithGroup("telas"), "telas")).toBe(true);
  });

  it("returns false for a member of another group", () => {
    expect(isEventVisibleToGroup(eventWithGroup("barra"), "telas")).toBe(false);
    expect(isEventVisibleToGroup(eventWithGroup("barra"), "ninguno")).toBe(false);
  });

  it("returns false for members without a group", () => {
    expect(isEventVisibleToGroup(eventWithGroup("limpieza"), "ninguno")).toBe(false);
  });

  it("always returns true for management", () => {
    expect(isEventVisibleToGroup(eventWithGroup("barra"), "telas", true)).toBe(true);
    expect(isEventVisibleToGroup(eventWithGroup("barra"), "ninguno", true)).toBe(true);
  });

  it("still hides group events from non-members without the management flag", () => {
    expect(isEventVisibleToGroup(eventWithGroup("estandarte"), "barra", false)).toBe(false);
  });
});
