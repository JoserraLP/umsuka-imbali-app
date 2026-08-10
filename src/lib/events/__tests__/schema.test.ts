import { describe, it, expect } from "vitest";
import {
  eventFormSchema,
  createEventSchema,
  updateEventSchema,
  deleteEventSchema,
  EVENT_TYPES,
  EVENT_WORKGROUPS,
} from "@/lib/events/schema";

// ── Valid base payload ────────────────────────────────

const validPayload = {
  title: "Ensayo general",
  description: "Ensayo de la comparsa.",
  eventType: "general" as const,
  eventDate: "2026-09-01T18:00",
  capacity: null,
  workgroup: null,
};

// ── eventFormSchema ───────────────────────────────────

describe("eventFormSchema", () => {
  it("accepts a valid general event", () => {
    const result = eventFormSchema.safeParse(validPayload);
    expect(result.success).toBe(true);
  });

  it("rejects empty title", () => {
    const result = eventFormSchema.safeParse({ ...validPayload, title: "" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toContain("title");
    }
  });

  it("rejects title exceeding 200 characters", () => {
    const result = eventFormSchema.safeParse({ ...validPayload, title: "A".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("normalizes empty description to null", () => {
    const result = eventFormSchema.safeParse({ ...validPayload, description: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
    }
  });

  it("rejects invalid event types", () => {
    const result = eventFormSchema.safeParse({ ...validPayload, eventType: "party" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid event date", () => {
    const result = eventFormSchema.safeParse({ ...validPayload, eventDate: "not-a-date" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toContain("eventDate");
    }
  });

  it("normalizes NaN capacity to null", () => {
    const result = eventFormSchema.safeParse({ ...validPayload, capacity: Number.NaN });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capacity).toBeNull();
    }
  });

  it("rejects non-positive capacity", () => {
    const result = eventFormSchema.safeParse({ ...validPayload, capacity: 0 });
    expect(result.success).toBe(false);
  });

  it("accepts a work_shift event with a workgroup", () => {
    const result = eventFormSchema.safeParse({
      ...validPayload,
      eventType: "work_shift",
      workgroup: "barra",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a work_shift event without a workgroup", () => {
    const result = eventFormSchema.safeParse({
      ...validPayload,
      eventType: "work_shift",
      workgroup: null,
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toContain("workgroup");
    }
  });

  it("rejects a work_shift event with 'ninguno'", () => {
    const result = eventFormSchema.safeParse({
      ...validPayload,
      eventType: "work_shift",
      workgroup: "ninguno" as never,
    });
    expect(result.success).toBe(false);
  });

  it("allows a general event without a workgroup", () => {
    const { workgroup: _workgroup, ...withoutWorkgroup } = validPayload;
    const result = eventFormSchema.safeParse(withoutWorkgroup);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.workgroup).toBeNull();
    }
  });

  it("exposes the allowed workgroups without 'ninguno'", () => {
    expect(EVENT_WORKGROUPS).toEqual(["telas", "barra", "estandarte", "limpieza"]);
  });

  it("exposes the full event type list", () => {
    expect(EVENT_TYPES).toContain("work_shift");
  });
});

// ── createEventSchema ─────────────────────────────────

describe("createEventSchema", () => {
  it("accepts a valid payload", () => {
    expect(createEventSchema.safeParse(validPayload).success).toBe(true);
  });

  it("requires a workgroup for work_shift events", () => {
    const result = createEventSchema.safeParse({
      ...validPayload,
      eventType: "work_shift",
      workgroup: null,
    });
    expect(result.success).toBe(false);
  });
});

// ── updateEventSchema ─────────────────────────────────

describe("updateEventSchema", () => {
  it("accepts a valid payload with id", () => {
    const result = updateEventSchema.safeParse({ ...validPayload, id: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid uuid", () => {
    const result = updateEventSchema.safeParse({ ...validPayload, id: "not-a-uuid" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]!.path).toContain("id");
    }
  });

  it("requires a workgroup when turning into work_shift", () => {
    const result = updateEventSchema.safeParse({
      ...validPayload,
      id: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a",
      eventType: "work_shift",
      workgroup: null,
    });
    expect(result.success).toBe(false);
  });
});

// ── deleteEventSchema ─────────────────────────────────

describe("deleteEventSchema", () => {
  it("accepts a valid id", () => {
    const result = deleteEventSchema.safeParse({ id: "0a0a0a0a-0a0a-4a0a-8a0a-0a0a0a0a0a0a" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid id", () => {
    expect(deleteEventSchema.safeParse({ id: "" }).success).toBe(false);
  });
});
