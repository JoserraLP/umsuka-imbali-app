import { describe, expect, it } from "vitest";
import { audienceSchema, updateEventAudienceSchema } from "@/lib/events/audience";
import {
  createEventSchema,
  eventFormSchema,
  updateEventSchema,
} from "@/lib/events/schema";

const UUID = "123e4567-e89b-12d3-a456-426614174000";
const UUID_2 = "223e4567-e89b-12d3-a456-426614174000";

function validEventInput(overrides: Record<string, unknown> = {}) {
  return {
    title: "Evento general",
    description: "",
    eventType: "general",
    eventDate: "2026-09-01T18:30",
    ...overrides,
  };
}

// ── audienceSchema (standalone section) ────────────────

describe("audienceSchema", () => {
  it("accepts the default 'all' audience and applies defaults", () => {
    const result = audienceSchema.safeParse({});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual({
        audienceType: "all",
        audienceWorkgroup: null,
        audienceMemberType: null,
        audienceUserIds: [],
      });
    }
  });

  it("normalizes '' workgroup/null member type to null (empty selects)", () => {
    const result = audienceSchema.safeParse({
      audienceType: "all",
      audienceWorkgroup: "",
      audienceMemberType: "",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.audienceWorkgroup).toBeNull();
      expect(result.data.audienceMemberType).toBeNull();
    }
  });

  it("accepts a workgroup audience with a valid group", () => {
    const result = audienceSchema.safeParse({
      audienceType: "workgroup",
      audienceWorkgroup: "barra",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a workgroup audience without a group (null)", () => {
    const result = audienceSchema.safeParse({ audienceType: "workgroup" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Debes elegir el grupo de trabajo al que se muestra el evento.",
      );
      expect(result.error.issues[0]?.path).toEqual(["audienceWorkgroup"]);
    }
  });

  it("rejects a workgroup audience with an empty group ('' via preprocess)", () => {
    const result = audienceSchema.safeParse({
      audienceType: "workgroup",
      audienceWorkgroup: "",
    });

    expect(result.success).toBe(false);
  });

  it("rejects 'ninguno' and other invalid workgroup values", () => {
    const ninguno = audienceSchema.safeParse({
      audienceType: "workgroup",
      audienceWorkgroup: "ninguno",
    });
    const invalid = audienceSchema.safeParse({
      audienceType: "workgroup",
      audienceWorkgroup: "audio",
    });

    expect(ninguno.success).toBe(false);
    expect(invalid.success).toBe(false);
  });

  it("accepts a member_type audience with a valid member type", () => {
    const result = audienceSchema.safeParse({
      audienceType: "member_type",
      audienceMemberType: "dance",
    });

    expect(result.success).toBe(true);
  });

  it("rejects a member_type audience without a type", () => {
    const result = audienceSchema.safeParse({ audienceType: "member_type" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Debes elegir el tipo de miembro al que se muestra el evento.",
      );
    }
  });

  it("rejects a member_type audience with an empty type ('') via preprocess", () => {
    const result = audienceSchema.safeParse({
      audienceType: "member_type",
      audienceMemberType: "",
    });

    expect(result.success).toBe(false);
  });

  it("accepts specific_users with at least one valid uuid", () => {
    const result = audienceSchema.safeParse({
      audienceType: "specific_users",
      audienceUserIds: [UUID],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.audienceUserIds).toEqual([UUID]);
    }
  });

  it("rejects specific_users without users", () => {
    const result = audienceSchema.safeParse({ audienceType: "specific_users" });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.message).toBe(
        "Debes seleccionar al menos un usuario.",
      );
      expect(result.error.issues[0]?.path).toEqual(["audienceUserIds"]);
    }
  });

  it("rejects specific_users with an invalid uuid", () => {
    const result = audienceSchema.safeParse({
      audienceType: "specific_users",
      audienceUserIds: [UUID, "not-a-uuid"],
    });

    expect(result.success).toBe(false);
  });

  it("rejects an unknown audience type", () => {
    const result = audienceSchema.safeParse({ audienceType: "everyone" });

    expect(result.success).toBe(false);
  });

  it("accepts stray stored values ('all' with a group) at schema level", () => {
    // Coherence between the audience type and its parameters is enforced in
    // resolveAudienceFields + DB CHECK constraints, not at the schema level.
    const result = audienceSchema.safeParse({
      audienceType: "all",
      audienceWorkgroup: "barra",
    });

    expect(result.success).toBe(true);
  });
});

// ── Event schemas (audience fields spread) ─────────────

describe("eventFormSchema audience fields", () => {
  it("accepts pre-Sprint-18 inputs (no audience fields) with defaults", () => {
    const result = eventFormSchema.safeParse(validEventInput());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.audienceType).toBe("all");
      expect(result.data.audienceWorkgroup).toBeNull();
      expect(result.data.audienceMemberType).toBeNull();
      expect(result.data.audienceUserIds).toEqual([]);
    }
  });

  it("applies the cross-field rule through the event schema", () => {
    const result = eventFormSchema.safeParse(
      validEventInput({ audienceType: "specific_users", audienceUserIds: [] }),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(
        result.error.issues.some((issue) => issue.path[0] === "audienceUserIds"),
      ).toBe(true);
    }
  });

  it("accepts a valid audience configuration in the event form", () => {
    const result = eventFormSchema.safeParse(
      validEventInput({
        audienceType: "workgroup",
        audienceWorkgroup: "telas",
      }),
    );

    expect(result.success).toBe(true);
  });

  it("still rejects an invalid event type", () => {
    const result = eventFormSchema.safeParse(validEventInput({ eventType: "party" }));

    expect(result.success).toBe(false);
  });
});

describe("createEventSchema / updateEventSchema audience fields", () => {
  it("createEventSchema accepts old inputs without audience fields", () => {
    const result = createEventSchema.safeParse(validEventInput());

    expect(result.success).toBe(true);
  });

  it("updateEventSchema accepts old inputs without audience fields", () => {
    const result = updateEventSchema.safeParse({ ...validEventInput(), id: UUID });

    expect(result.success).toBe(true);
  });

  it("updateEventSchema accepts a specific_users audience", () => {
    const result = updateEventSchema.safeParse({
      ...validEventInput(),
      id: UUID,
      audienceType: "specific_users",
      audienceUserIds: [UUID_2],
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.audienceUserIds).toEqual([UUID_2]);
    }
  });
});

// ── updateEventAudienceSchema ──────────────────────────

describe("updateEventAudienceSchema", () => {
  it("requires a valid event id", () => {
    const result = updateEventAudienceSchema.safeParse({
      eventId: "nope",
      audienceType: "all",
    });

    expect(result.success).toBe(false);
  });

  it("applies cross-field rules and defaults", () => {
    const all = updateEventAudienceSchema.safeParse({ eventId: UUID });
    expect(all.success).toBe(true);
    if (all.success) {
      expect(all.data.audienceType).toBe("all");
    }

    const missingGroup = updateEventAudienceSchema.safeParse({
      eventId: UUID,
      audienceType: "workgroup",
    });
    expect(missingGroup.success).toBe(false);
  });

  it("propagates the audience values to the parsed output", () => {
    const result = updateEventAudienceSchema.safeParse({
      eventId: UUID,
      audienceType: "member_type",
      audienceMemberType: "music",
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.audienceMemberType).toBe("music");
      expect(result.data.audienceUserIds).toEqual([]);
    }
  });
});