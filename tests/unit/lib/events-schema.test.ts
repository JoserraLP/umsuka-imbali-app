import { describe, expect, it } from "vitest";
import {
  eventFormSchema,
  createEventSchema,
  updateEventSchema,
  deleteEventSchema,
} from "@/lib/events/schema";

describe("eventFormSchema", () => {
  it("accepts valid input and normalizes an empty description to null", () => {
    const result = eventFormSchema.safeParse({
      title: "Reunión de junta",
      description: "",
      eventType: "meeting",
      eventDate: "2026-09-01T18:30",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBeNull();
    }
  });

  it("keeps a non-empty description", () => {
    const result = eventFormSchema.safeParse({
      title: "Desfile de Carnaval",
      description: "Recorrido por el centro de la ciudad",
      eventType: "carnival",
      eventDate: "2026-02-14T16:00",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.description).toBe("Recorrido por el centro de la ciudad");
    }
  });

  it("rejects an empty title", () => {
    const result = eventFormSchema.safeParse({
      title: "",
      eventType: "general",
      eventDate: "2026-09-01T18:30",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid event type", () => {
    const result = eventFormSchema.safeParse({
      title: "Evento",
      eventType: "party",
      eventDate: "2026-09-01T18:30",
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unparsable event date", () => {
    const result = eventFormSchema.safeParse({
      title: "Evento",
      eventType: "general",
      eventDate: "not-a-date",
    });

    expect(result.success).toBe(false);
  });

  it("accepts a full ISO 8601 date (as produced by the client before submission)", () => {
    const result = eventFormSchema.safeParse({
      title: "Evento",
      eventType: "general",
      eventDate: new Date("2026-09-01T18:30:00.000Z").toISOString(),
    });

    expect(result.success).toBe(true);
  });

  it("normalizes a missing capacity to null (unlimited)", () => {
    const result = eventFormSchema.safeParse({
      title: "Evento",
      eventType: "general",
      eventDate: "2026-09-01T18:30",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capacity).toBeNull();
    }
  });

  it("normalizes NaN capacity (from an empty number input) to null", () => {
    const result = eventFormSchema.safeParse({
      title: "Evento",
      eventType: "general",
      eventDate: "2026-09-01T18:30",
      capacity: Number.NaN,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capacity).toBeNull();
    }
  });

  it("accepts a positive integer capacity", () => {
    const result = eventFormSchema.safeParse({
      title: "Evento",
      eventType: "general",
      eventDate: "2026-09-01T18:30",
      capacity: 25,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.capacity).toBe(25);
    }
  });

  it("rejects a zero or negative capacity", () => {
    const result = eventFormSchema.safeParse({
      title: "Evento",
      eventType: "general",
      eventDate: "2026-09-01T18:30",
      capacity: 0,
    });

    expect(result.success).toBe(false);
  });

  it("rejects a non-integer capacity", () => {
    const result = eventFormSchema.safeParse({
      title: "Evento",
      eventType: "general",
      eventDate: "2026-09-01T18:30",
      capacity: 3.5,
    });

    expect(result.success).toBe(false);
  });
});

describe("createEventSchema", () => {
  it("is equivalent to eventFormSchema (no id required)", () => {
    const result = createEventSchema.safeParse({
      title: "Evento",
      eventType: "general",
      eventDate: "2026-09-01T18:30",
    });

    expect(result.success).toBe(true);
  });
});

describe("updateEventSchema", () => {
  it("requires a valid uuid id in addition to the form fields", () => {
    const result = updateEventSchema.safeParse({
      id: "123e4567-e89b-12d3-a456-426614174000",
      title: "Evento actualizado",
      eventType: "general",
      eventDate: "2026-09-01T18:30",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a missing id", () => {
    const result = updateEventSchema.safeParse({
      title: "Evento actualizado",
      eventType: "general",
      eventDate: "2026-09-01T18:30",
    });

    expect(result.success).toBe(false);
  });
});

describe("deleteEventSchema", () => {
  it("accepts a valid uuid", () => {
    const result = deleteEventSchema.safeParse({ id: "123e4567-e89b-12d3-a456-426614174000" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid uuid", () => {
    const result = deleteEventSchema.safeParse({ id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });
});
