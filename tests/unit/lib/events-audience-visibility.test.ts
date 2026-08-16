import { describe, expect, it, vi, beforeEach } from "vitest";

// The module imports server/session deps at module level (used by its
// query/mutation functions); the pure mirror needs none of them.
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

import { isEventVisibleToAudience, type AudienceVisibilityContext } from "@/lib/events/audience";

const EVENT_ID = "123e4567-e89b-12d3-a456-426614174000";

function makeEvent(overrides: Record<string, unknown> = {}) {
  return {
    id: EVENT_ID,
    visibleToGroup: null,
    audienceType: "all",
    audienceWorkgroup: null,
    audienceMemberType: null,
    ...overrides,
  };
}

function makeContext(overrides: Partial<AudienceVisibilityContext> = {}): AudienceVisibilityContext {
  return {
    userWorkgroup: "barra",
    userComponent: "music",
    audienceEventIds: new Set([EVENT_ID]),
    isManagement: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("isEventVisibleToAudience", () => {
  it("returns true for management regardless of audience", () => {
    const ctx = makeContext({
      isManagement: true,
      userWorkgroup: "limpieza",
      audienceEventIds: new Set(),
    });

    expect(isEventVisibleToAudience(makeEvent({ audienceType: "specific_users" }), ctx)).toBe(
      true,
    );
  });

  it("returns true for a plain 'all' event", () => {
    expect(isEventVisibleToAudience(makeEvent(), makeContext())).toBe(true);
  });

  it("treats a null audienceType as 'all'", () => {
    expect(isEventVisibleToAudience(makeEvent({ audienceType: null }), makeContext())).toBe(true);
  });

  it("still applies the legacy group rule for 'all' events", () => {
    const ctx = makeContext({ userWorkgroup: "telas" });
    const event = makeEvent({ visibleToGroup: "barra" });

    expect(isEventVisibleToAudience(event, ctx)).toBe(false);
  });

  it("workgroup audience matches the viewer's workgroup", () => {
    const event = makeEvent({ audienceType: "workgroup", audienceWorkgroup: "barra" });

    expect(isEventVisibleToAudience(event, makeContext())).toBe(true);
  });

  it("workgroup audience misses when workgroups differ", () => {
    const event = makeEvent({ audienceType: "workgroup", audienceWorkgroup: "telas" });

    expect(isEventVisibleToAudience(event, makeContext())).toBe(false);
  });

  it("'ninguno' workgroup audience never matches", () => {
    const event = makeEvent({ audienceType: "workgroup", audienceWorkgroup: "ninguno" });
    const ctx = makeContext({ userWorkgroup: "ninguno" });

    expect(isEventVisibleToAudience(event, ctx)).toBe(false);
  });

  it("member_type audience matches the viewer's component", () => {
    const event = makeEvent({ audienceType: "member_type", audienceMemberType: "music" });

    expect(isEventVisibleToAudience(event, makeContext())).toBe(true);
  });

  it("member_type audience misses when components differ", () => {
    const event = makeEvent({ audienceType: "member_type", audienceMemberType: "dance" });

    expect(isEventVisibleToAudience(event, makeContext())).toBe(false);
  });

  it("specific_users matches when the event id is in the viewer's set", () => {
    const event = makeEvent({ audienceType: "specific_users" });

    expect(isEventVisibleToAudience(event, makeContext())).toBe(true);
  });

  it("specific_users misses when the event id is not in the set", () => {
    const ctx = makeContext({ audienceEventIds: new Set() });
    const event = makeEvent({ audienceType: "specific_users" });

    expect(isEventVisibleToAudience(event, ctx)).toBe(false);
  });

  it("applies group AND audience intersection (both must pass)", () => {
    const event = makeEvent({
      visibleToGroup: "limpieza",
      audienceType: "workgroup",
      audienceWorkgroup: "barra",
    });

    expect(isEventVisibleToAudience(event, makeContext())).toBe(false);
  });

  it("fails closed on an unknown audience type", () => {
    const event = makeEvent({ audienceType: "whoever" });

    expect(isEventVisibleToAudience(event, makeContext())).toBe(false);
  });
});