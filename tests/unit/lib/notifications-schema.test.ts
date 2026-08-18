import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  NOTIFICATION_TYPES,
  NOTIFICATION_TYPE_LABELS,
  isNotificationType,
  createNotificationSchema,
  updateNotificationPreferencesSchema,
  mapNotificationRow,
  mapPreferenceRow,
  formatRelativeTime,
} from "@/lib/notifications/schema";

const NOW = new Date("2026-08-17T12:00:00.000Z");

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

function isoAgo(msAgo: number): string {
  return new Date(NOW.getTime() - msAgo).toISOString();
}

// ── Constants + guards ─────────────────────────────────

describe("constants and type guards", () => {
  it("exposes the 5 canonical notification types", () => {
    expect(NOTIFICATION_TYPES).toEqual([
      "event_created",
      "news_created",
      "voting_created",
      "shift_assigned",
      "profile_approved",
    ]);
  });

  it("labels every type with its Spanish label", () => {
    expect(NOTIFICATION_TYPE_LABELS).toEqual({
      event_created: "Nuevo evento",
      news_created: "Nueva noticia",
      voting_created: "Nueva votación",
      shift_assigned: "Turno asignado",
      profile_approved: "Cuenta aprobada",
    });
  });

  it("isNotificationType accepts the 5 known values and nothing else", () => {
    for (const type of NOTIFICATION_TYPES) {
      expect(isNotificationType(type)).toBe(true);
    }
    expect(isNotificationType("event_deleted")).toBe(false);
    expect(isNotificationType("")).toBe(false);
    expect(isNotificationType(42)).toBe(false);
    expect(isNotificationType(null)).toBe(false);
    expect(isNotificationType(undefined)).toBe(false);
  });
});

// ── createNotificationSchema ───────────────────────────

describe("createNotificationSchema", () => {
  const base = {
    user_id: "123e4567-e89b-12d3-a456-426614174000",
    title: "Nuevo evento: Ensayo general",
    type: "event_created",
  } as const;

  it("accepts a minimal valid payload", () => {
    const result = createNotificationSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBeNull();
      expect(result.data.link).toBeNull();
    }
  });

  it("accepts message and link and trims them", () => {
    const result = createNotificationSchema.safeParse({
      ...base,
      message: "  Ensayo de carnaval  ",
      link: "  /events/abc  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBe("Ensayo de carnaval");
      expect(result.data.link).toBe("/events/abc");
    }
  });

  it("coerces empty string message/link to null", () => {
    const result = createNotificationSchema.safeParse({ ...base, message: "", link: "" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.message).toBeNull();
      expect(result.data.link).toBeNull();
    }
  });

  it("rejects a non-uuid user_id", () => {
    const result = createNotificationSchema.safeParse({ ...base, user_id: "not-a-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty title", () => {
    const result = createNotificationSchema.safeParse({ ...base, title: "   " });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("El título es obligatorio.");
    }
  });

  it("rejects a title longer than 200 characters", () => {
    const result = createNotificationSchema.safeParse({ ...base, title: "x".repeat(201) });
    expect(result.success).toBe(false);
  });

  it("rejects a message longer than 1000 characters", () => {
    const result = createNotificationSchema.safeParse({ ...base, message: "x".repeat(1001) });
    expect(result.success).toBe(false);
  });

  it("rejects a link longer than 2048 characters", () => {
    const result = createNotificationSchema.safeParse({ ...base, link: "x".repeat(2049) });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown type", () => {
    const result = createNotificationSchema.safeParse({ ...base, type: "event_deleted" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe("Tipo de notificación no válido.");
    }
  });
});

// ── updateNotificationPreferencesSchema ────────────────

describe("updateNotificationPreferencesSchema", () => {
  it("accepts an empty list ('{}' = receive everything)", () => {
    const result = updateNotificationPreferencesSchema.safeParse({ types: [] });
    expect(result.success).toBe(true);
  });

  it("accepts any subset of the 5 known types", () => {
    const result = updateNotificationPreferencesSchema.safeParse({
      types: ["event_created", "shift_assigned"],
    });
    expect(result.success).toBe(true);
  });

  it("dedupes repeated types", () => {
    const result = updateNotificationPreferencesSchema.safeParse({
      types: ["event_created", "event_created", "shift_assigned", "shift_assigned"],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.types).toEqual(["event_created", "shift_assigned"]);
    }
  });

  it("rejects more types than the total known", () => {
    const result = updateNotificationPreferencesSchema.safeParse({
      types: Array.from({ length: NOTIFICATION_TYPES.length + 1 }, (_, i) =>
        i % NOTIFICATION_TYPES.length === 0 ? "event_created" : "news_created",
      ),
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown type values", () => {
    const result = updateNotificationPreferencesSchema.safeParse({ types: ["bogus"] });
    expect(result.success).toBe(false);
  });
});

// ── Mappers ────────────────────────────────────────────

describe("pure mappers", () => {
  it("maps a notification row to the camelCase UI shape", () => {
    expect(
      mapNotificationRow({
        id: "n1",
        user_id: "u1",
        title: "Turno asignado: Barra",
        message: "Ensayo general",
        type: "shift_assigned",
        is_read: false,
        link: "/events/e1",
        created_at: "2026-08-17T10:00:00.000Z",
      }),
    ).toEqual({
      id: "n1",
      userId: "u1",
      title: "Turno asignado: Barra",
      message: "Ensayo general",
      type: "shift_assigned",
      isRead: false,
      link: "/events/e1",
      createdAt: "2026-08-17T10:00:00.000Z",
    });
  });

  it("maps a preference row preserving the '{}' empty-array semantic", () => {
    expect(mapPreferenceRow({ user_id: "u1", types: [] })).toEqual({
      userId: "u1",
      types: [],
    });
    expect(
      mapPreferenceRow({ user_id: "u1", types: ["event_created", "profile_approved"] }),
    ).toEqual({
      userId: "u1",
      types: ["event_created", "profile_approved"],
    });
  });
});

// ── formatRelativeTime ─────────────────────────────────

describe("formatRelativeTime", () => {
  it("returns 'ahora' for less than a minute", () => {
    expect(formatRelativeTime(isoAgo(5_000))).toBe("ahora");
    expect(formatRelativeTime(isoAgo(59_999))).toBe("ahora");
  });

  it("returns 'hace X min' for less than an hour", () => {
    expect(formatRelativeTime(isoAgo(60_000))).toBe("hace 1 min");
    expect(formatRelativeTime(isoAgo(37 * 60_000))).toBe("hace 37 min");
  });

  it("returns 'hace X h' for the same calendar day", () => {
    expect(formatRelativeTime(isoAgo(2 * 3_600_000))).toBe("hace 2 h");
  });

  it("returns 'ayer' for the previous calendar day", () => {
    expect(formatRelativeTime("2026-08-16T23:59:00.000Z")).toBe("ayer");
    expect(formatRelativeTime("2026-08-16T00:00:00.000Z")).toBe("ayer");
  });

  it("returns the short locale date for older items", () => {
    expect(formatRelativeTime("2026-08-10T10:00:00.000Z")).toBe("10/08/2026");
  });

  it("returns '' for unparseable input", () => {
    expect(formatRelativeTime("not-a-date")).toBe("");
    expect(formatRelativeTime("")).toBe("");
  });
});
