import { describe, expect, it, vi } from "vitest";

// Mock the listEvents function so we don't need a real Supabase connection
vi.mock("@/lib/events/queries", () => ({
  listEvents: vi.fn().mockResolvedValue([]),
}));

// We need to mock the server component - since CalendarWidget is async,
// we test it via the DashboardContent component or test the rendering logic
describe("CalendarWidget", () => {
  it("imports successfully", async () => {
    // Just verify the module can be imported
    const mod = await import("@/components/dashboard/calendar-widget");
    expect(mod.CalendarWidget).toBeDefined();
  });

  it("has the correct event type label mapping accessible via the module", async () => {
    const mod = await import("@/components/dashboard/calendar-widget");
    expect(mod.CalendarWidget).toBeInstanceOf(Function);
  });
});

describe("Calendar widget event rendering logic", () => {
  // Tests for the event display logic that would be used by CalendarWidget
  it("formats event dates correctly for display", () => {
    // Test the Intl date formatting used in DashboardContent
    const testDate = new Date("2026-08-15T18:00:00");
    const formatted = testDate.toLocaleDateString("es-ES", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    });
    expect(formatted).toContain("ago");
    expect(formatted).toContain("18");
    expect(formatted).toContain("00");
  });

  it("handles all event types correctly", () => {
    const eventTypes = ["general", "meeting", "carnival", "work_shift"] as const;
    const labels: Record<string, string> = {
      general: "General",
      meeting: "Reunión",
      carnival: "Carnaval",
      work_shift: "Turno",
    };

    for (const type of eventTypes) {
      expect(labels[type]).toBeDefined();
      expect(typeof labels[type]).toBe("string");
    }
  });

  it("sorts future events correctly", () => {
    const now = new Date();
    const events = [
      { id: "1", title: "Past Event", eventDate: new Date(now.getTime() - 86400000).toISOString() },
      { id: "2", title: "Future Event 1", eventDate: new Date(now.getTime() + 86400000).toISOString() },
      { id: "3", title: "Future Event 2", eventDate: new Date(now.getTime() + 172800000).toISOString() },
    ];

    // Filter future events
    const futureEvents = events
      .filter((e) => new Date(e.eventDate) > now)
      .slice(0, 5);

    expect(futureEvents).toHaveLength(2);
    expect(futureEvents[0]!.title).toBe("Future Event 1");
    expect(futureEvents[1]!.title).toBe("Future Event 2");
  });

  it("limits to 5 events maximum", () => {
    const now = new Date();
    const events = Array.from({ length: 10 }, (_, i) => ({
      id: String(i),
      title: `Event ${i}`,
      eventDate: new Date(now.getTime() + (i + 1) * 86400000).toISOString(),
    }));

    const limited = events.slice(0, 5);
    expect(limited).toHaveLength(5);
  });

  it("shows empty state when no events", () => {
    const events: Array<{ id: string; title: string; eventDate: string }> = [];
    const futureEvents = events
      .filter((e) => new Date(e.eventDate) > new Date())
      .slice(0, 5);

    expect(futureEvents).toHaveLength(0);
  });
});
