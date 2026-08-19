import { describe, it, expect } from "vitest";
import {
  SETTING_KEYS,
  SETTING_KEY_LABELS,
  AUDIT_ACTIONS,
  AUDIT_ACTION_LABELS,
  AUDIT_PAGE_SIZE,
  updateSettingSchema,
  logAuditActionSchema,
  auditLogFiltersSchema,
  mapSettingsRow,
  mapAuditLogRow,
  type SettingKey,
  type AdminAuditAction,
} from "@/lib/admin/schema";

const ACTOR_ID = "123e4567-e89b-12d3-a456-426614174000";
const TARGET_USER = "323e4567-e89b-12d3-a456-426614174000";

// ── Constants ───────────────────────────────────────────

describe("admin schema constants", () => {
  it("exposes exactly the two seeded setting keys", () => {
    expect(SETTING_KEYS).toEqual(["app_name", "instagram_url"]);
  });

  it("labels every setting key in Spanish", () => {
    for (const key of SETTING_KEYS) {
      expect(SETTING_KEY_LABELS[key]).toBeTruthy();
    }
    expect(SETTING_KEY_LABELS.app_name).toContain("Nombre");
  });

  it("exposes exactly the 14 audited administrative actions", () => {
    expect(AUDIT_ACTIONS).toEqual([
      "user.role_changed",
      "user.activated",
      "user.deactivated",
      "user.approved",
      "user.suspended",
      "user.profile_updated",
      "user.component_type_changed",
      "user.workgroup_changed",
      "user.component_lead_changed",
      "user.emailless_created",
      "user.password_reset_generated",
      "user.account_unlocked",
      "settings.updated",
      "user.deleted",
    ]);
    expect(AUDIT_ACTIONS).toHaveLength(14);
  });

  it("labels every audit action in Spanish (non-empty)", () => {
    for (const action of AUDIT_ACTIONS) {
      expect(AUDIT_ACTION_LABELS[action]).toBeTruthy();
    }
    expect(AUDIT_ACTION_LABELS["settings.updated"]).toContain("Configuración");
    expect(AUDIT_ACTION_LABELS["user.deleted"]).toContain("eliminada");
  });

  it("uses a page size of 50 for the audit log list", () => {
    expect(AUDIT_PAGE_SIZE).toBe(50);
  });
});

// ── updateSettingSchema ─────────────────────────────────

describe("updateSettingSchema", () => {
  it("accepts a valid value for every known key", () => {
    for (const key of SETTING_KEYS) {
      const parsed = updateSettingSchema.safeParse({ key, value: "  valor de prueba  " });
      expect(parsed.success).toBe(true);
    }
  });

  it("trims the value before persisting", () => {
    const parsed = updateSettingSchema.safeParse({ key: "app_name", value: "  Umsuka Imbali  " });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.value).toBe("Umsuka Imbali");
    }
  });

  it("rejects an empty app_name (the app identifier cannot be blank)", () => {
    const parsed = updateSettingSchema.safeParse({ key: "app_name", value: "   " });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain("vacío");
    }
  });

  it("allows clearing instagram_url (optional setting)", () => {
    const parsed = updateSettingSchema.safeParse({ key: "instagram_url", value: "" });
    expect(parsed.success).toBe(true);
  });

  it("rejects values longer than 300 characters", () => {
    const parsed = updateSettingSchema.safeParse({
      key: "instagram_url",
      value: "x".repeat(301),
    });
    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues[0]?.message).toContain("300");
    }
  });

  it("rejects unknown setting keys", () => {
    const parsed = updateSettingSchema.safeParse({ key: "bogus_key", value: "x" });
    expect(parsed.success).toBe(false);
  });
});

// ── logAuditActionSchema ────────────────────────────────

describe("logAuditActionSchema", () => {
  it("accepts a full audit input (actor, action, entity + details)", () => {
    const parsed = logAuditActionSchema.safeParse({
      actorId: ACTOR_ID,
      action: "user.role_changed",
      entityType: "profile",
      entityId: TARGET_USER,
      details: { fromRole: "member", toRole: "event_manager" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).toEqual({
        actorId: ACTOR_ID,
        action: "user.role_changed",
        entityType: "profile",
        entityId: TARGET_USER,
        details: { fromRole: "member", toRole: "event_manager" },
      });
    }
  });

  it("coerces an empty entityId to null", () => {
    const parsed = logAuditActionSchema.safeParse({
      actorId: ACTOR_ID,
      action: "settings.updated",
      entityType: "settings",
      entityId: "",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.entityId).toBeNull();
    }
  });

  it("coerces missing or null details to null", () => {
    expect(
      logAuditActionSchema.parse({
        actorId: ACTOR_ID,
        action: "user.activated",
        entityType: "profile",
        entityId: TARGET_USER,
      }).details,
    ).toBeNull();
    expect(
      logAuditActionSchema.parse({
        actorId: ACTOR_ID,
        action: "user.activated",
        entityType: "profile",
        entityId: TARGET_USER,
        details: null,
      }).details,
    ).toBeNull();
  });

  it("rejects an action outside the 14 audited actions", () => {
    const parsed = logAuditActionSchema.safeParse({
      actorId: ACTOR_ID,
      action: "user.banned",
      entityType: "profile",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects a non-uuid actorId", () => {
    const parsed = logAuditActionSchema.safeParse({
      actorId: "not-a-uuid",
      action: "user.activated",
      entityType: "profile",
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an entityType longer than 100 characters", () => {
    const parsed = logAuditActionSchema.safeParse({
      actorId: ACTOR_ID,
      action: "user.activated",
      entityType: "x".repeat(101),
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects an entityId longer than 200 characters", () => {
    const parsed = logAuditActionSchema.safeParse({
      actorId: ACTOR_ID,
      action: "user.activated",
      entityType: "profile",
      entityId: "x".repeat(201),
    });
    expect(parsed.success).toBe(false);
  });
});

// ── auditLogFiltersSchema ───────────────────────────────

describe("auditLogFiltersSchema", () => {
  it("parses empty filters with defaults (page 1, offset 0)", () => {
    const filters = auditLogFiltersSchema.parse({});
    expect(filters).toEqual({ page: 1, offset: 0 });
  });

  it("parses user, action, from, to and page, computing the offset", () => {
    const filters = auditLogFiltersSchema.parse({
      user: TARGET_USER,
      action: "user.role_changed",
      from: "2026-08-01",
      to: "2026-08-18",
      page: "3",
    });
    expect(filters.user).toBe(TARGET_USER);
    expect(filters.action).toBe("user.role_changed");
    expect(filters.from).toBe("2026-08-01");
    expect(filters.page).toBe(3);
    expect(filters.offset).toBe(100); // (3 - 1) * 50
  });

  it("keeps 'to' raw (YYYY-MM-DD) and derives toEndOfDay for the query layer (M1 round-trip)", () => {
    const filters = auditLogFiltersSchema.parse({ to: "2026-08-18" });
    expect(filters.to).toBe("2026-08-18");
    expect(filters.toEndOfDay).toBe("2026-08-18T23:59:59.999Z");
  });

  it("leaves toEndOfDay undefined when 'to' is empty", () => {
    const filters = auditLogFiltersSchema.parse({ to: "" });
    expect(filters.to).toBeUndefined();
    expect(filters.toEndOfDay).toBeUndefined();
  });

  it("normalizes empty strings to undefined filters", () => {
    const filters = auditLogFiltersSchema.parse({
      user: "",
      action: "",
      from: "",
      to: "",
      page: "1",
    });
    expect(filters.user).toBeUndefined();
    expect(filters.action).toBeUndefined();
    expect(filters.from).toBeUndefined();
    expect(filters.to).toBeUndefined();
  });

  it("rejects a non-uuid user filter", () => {
    expect(auditLogFiltersSchema.safeParse({ user: "bogus" }).success).toBe(false);
  });

  it("rejects an action outside the audited set", () => {
    expect(auditLogFiltersSchema.safeParse({ action: "user.banned" }).success).toBe(false);
  });

  it("rejects malformed from/to dates", () => {
    expect(auditLogFiltersSchema.safeParse({ from: "18/08/2026" }).success).toBe(false);
    expect(auditLogFiltersSchema.safeParse({ to: "2026-08" }).success).toBe(false);
  });

  it("rejects page numbers below 1 (page 0 and negative)", () => {
    expect(auditLogFiltersSchema.safeParse({ page: "0" }).success).toBe(false);
    expect(auditLogFiltersSchema.safeParse({ page: "-2" }).success).toBe(false);
  });

  it("rejects a non-integer page", () => {
    expect(auditLogFiltersSchema.safeParse({ page: "2.5" }).success).toBe(false);
  });
});

// ── Mappers ─────────────────────────────────────────────

describe("admin row mappers", () => {
  it("mapSettingsRow maps snake_case to the camelCase UI shape", () => {
    const item = mapSettingsRow({
      key: "app_name",
      value: "Umsuka Imbali",
      updated_by: ACTOR_ID,
      updated_at: "2026-08-18T10:00:00.000Z",
    });
    expect(item).toEqual({
      key: "app_name",
      value: "Umsuka Imbali",
      updatedBy: ACTOR_ID,
      updatedAt: "2026-08-18T10:00:00.000Z",
    });
    expect(item satisfies { key: string; value: string; updatedBy: string | null; updatedAt: string }).toBeTruthy();
  });

  it("mapAuditLogRow maps snake_case to the camelCase UI shape (details preserved)", () => {
    const base = mapAuditLogRow({
      id: "log-1",
      user_id: ACTOR_ID,
      action: "user.role_changed" as AdminAuditAction,
      entity_type: "profile",
      entity_id: TARGET_USER,
      details: { fromRole: "member", toRole: "admin" },
      created_at: "2026-08-18T10:00:00.000Z",
    });
    expect(base).toEqual({
      id: "log-1",
      userId: ACTOR_ID,
      action: "user.role_changed",
      entityType: "profile",
      entityId: TARGET_USER,
      details: { fromRole: "member", toRole: "admin" },
      createdAt: "2026-08-18T10:00:00.000Z",
    });
  });

  it("mapAuditLogRow keeps null entity_id and details as null", () => {
    const base = mapAuditLogRow({
      id: "log-2",
      user_id: null,
      action: "settings.updated" as AdminAuditAction,
      entity_type: "settings",
      entity_id: null,
      details: null,
      created_at: "2026-08-18T10:00:00.000Z",
    });
    expect(base.entityId).toBeNull();
    expect(base.userId).toBeNull();
    expect(base.details).toBeNull();
  });

  it("SETTING_KEYS is a valid SettingKey[] (type-level sanity)", () => {
    const keys: readonly SettingKey[] = SETTING_KEYS;
    expect(keys.length).toBeGreaterThan(0);
  });
});