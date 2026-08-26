import { describe, it, expect } from "vitest";
import { REHEARSAL_CATEGORIES, isRehearsalCategory, REHEARSAL_CATEGORY_LABELS, autoEnrollRehearsalSchema } from "@/lib/rehearsals/auto-enroll";
import { REHEARSAL_CATEGORIES as EVENT_REHEARSAL_CATEGORIES } from "@/lib/events/schema";
import { eventFormSchema, createEventSchema } from "@/lib/events/schema";

describe("rehearsal auto-enroll constants", () => {
  it("exposes music,dance as categories matching events schema", () => {
    expect(REHEARSAL_CATEGORIES).toEqual(["music", "dance"]);
    expect(EVENT_REHEARSAL_CATEGORIES).toEqual(["music", "dance"]);
  });

  it("labels every category in Spanish", () => {
    expect(REHEARSAL_CATEGORY_LABELS).toEqual({ music: "Música", dance: "Baile" });
  });

  it("isRehearsalCategory accepts valid and rejects others", () => {
    expect(isRehearsalCategory("music")).toBe(true);
    expect(isRehearsalCategory("dance")).toBe(true);
    expect(isRehearsalCategory("telas")).toBe(false);
    expect(isRehearsalCategory("")).toBe(false);
  });

  it("autoEnrollRehearsalSchema validates uuid + category", () => {
    const uuid = "123e4567-e89b-12d3-a456-426614174000";
    expect(autoEnrollRehearsalSchema.safeParse({ eventId: uuid, category: "music" }).success).toBe(true);
    expect(autoEnrollRehearsalSchema.safeParse({ eventId: "not-uuid", category: "music" }).success).toBe(false);
    expect(autoEnrollRehearsalSchema.safeParse({ eventId: uuid, category: "telas" }).success).toBe(false);
  });
});

describe("events schema — rehearsalCategory (Sprint 32)", () => {
  it("rejects rehearsal without category", () => {
    const result = createEventSchema.safeParse({
      title: "Ensayo música",
      eventType: "rehearsal",
      eventDate: "2026-09-01T18:30",
      morningSession: true,
      afternoonSession: false,
    });
    expect(result.success).toBe(false);
  });

  it("accepts rehearsal with music category and session", () => {
    const result = createEventSchema.safeParse({
      title: "Ensayo música",
      eventType: "rehearsal",
      eventDate: "2026-09-01T18:30",
      morningSession: true,
      afternoonSession: false,
      rehearsalCategory: "music",
    });
    expect(result.success).toBe(true);
  });

  it("accepts rehearsal with dance category", () => {
    const result = createEventSchema.safeParse({
      title: "Ensayo baile",
      eventType: "rehearsal",
      eventDate: "2026-09-01T18:30",
      morningSession: false,
      afternoonSession: true,
      rehearsalCategory: "dance",
    });
    expect(result.success).toBe(true);
  });

  it("rejects non-rehearsal with rehearsalCategory", () => {
    const result = eventFormSchema.safeParse({
      title: "Evento general",
      eventType: "general",
      eventDate: "2026-09-01T18:30",
      rehearsalCategory: "music",
    });
    expect(result.success).toBe(false);
  });

  it("accepts non-rehearsal with null/undefined rehearsalCategory", () => {
    const r1 = eventFormSchema.safeParse({
      title: "General",
      eventType: "general",
      eventDate: "2026-09-01T18:30",
    });
    expect(r1.success).toBe(true);
    const r2 = eventFormSchema.safeParse({
      title: "General",
      eventType: "general",
      eventDate: "2026-09-01T18:30",
      rehearsalCategory: null,
    });
    expect(r2.success).toBe(true);
  });

  it("still requires at least one session for rehearsal", () => {
    const result = createEventSchema.safeParse({
      title: "Ensayo",
      eventType: "rehearsal",
      eventDate: "2026-09-01T18:30",
      morningSession: false,
      afternoonSession: false,
      rehearsalCategory: "music",
    });
    expect(result.success).toBe(false);
  });
});
