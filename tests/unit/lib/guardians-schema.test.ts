import { describe, it, expect } from "vitest";
import {
  createGuardianSchema,
  updateGuardianSchema,
  assignGuardianSchema,
  unassignGuardianSchema,
  setMinorStatusSchema,
} from "@/lib/guardians/schema";

const VALID_UUID = "123e4567-e89b-12d3-a456-426614174001";
const OTHER_UUID = "123e4567-e89b-12d3-a456-426614174002";

function validExternal() {
  return {
    full_name: "María López",
    document_id: "12345678A",
    email: "maria@example.com",
    phone: "+34 600 000 000",
    relationship: "Madre",
    is_member: false,
    member_user_id: null,
  };
}

function validMember() {
  return {
    full_name: "Juan Pérez",
    is_member: true,
    member_user_id: VALID_UUID,
  };
}

describe("createGuardianSchema", () => {
  it("accepts valid external guardian", () => {
    expect(createGuardianSchema.safeParse(validExternal()).success).toBe(true);
  });

  it("accepts valid member guardian", () => {
    expect(createGuardianSchema.safeParse(validMember()).success).toBe(true);
  });

  it("accepts external with empty optional fields normalized to null", () => {
    const result = createGuardianSchema.safeParse({
      full_name: "Ana García",
      document_id: "   ",
      email: "   ",
      phone: "",
      relationship: "",
      is_member: false,
      member_user_id: null,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.document_id).toBeNull();
      expect(result.data.email).toBeNull();
      expect(result.data.phone).toBeNull();
      expect(result.data.relationship).toBeNull();
    }
  });

  it("rejects empty full_name", () => {
    expect(createGuardianSchema.safeParse({ ...validExternal(), full_name: "" }).success).toBe(false);
  });

  it("rejects full_name only whitespace", () => {
    expect(createGuardianSchema.safeParse({ ...validExternal(), full_name: "   " }).success).toBe(false);
  });

  it("rejects full_name exceeding 200", () => {
    expect(createGuardianSchema.safeParse({ ...validExternal(), full_name: "a".repeat(201) }).success).toBe(false);
  });

  it("rejects document_id exceeding 50", () => {
    expect(createGuardianSchema.safeParse({ ...validExternal(), document_id: "a".repeat(51) }).success).toBe(false);
  });

  it("rejects email invalid", () => {
    expect(createGuardianSchema.safeParse({ ...validExternal(), email: "not-an-email" }).success).toBe(false);
  });

  it("rejects email exceeding 320", () => {
    expect(createGuardianSchema.safeParse({ ...validExternal(), email: "a".repeat(321) + "@x.com" }).success).toBe(false);
  });

  it("normalizes empty email to null", () => {
    const result = createGuardianSchema.safeParse({ ...validExternal(), email: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.email).toBeNull();
  });

  it("accepts valid phone", () => {
    expect(createGuardianSchema.safeParse({ ...validExternal(), phone: "+34 600 123 456" }).success).toBe(true);
  });

  it("rejects invalid phone", () => {
    expect(createGuardianSchema.safeParse({ ...validExternal(), phone: "abc!!!" }).success).toBe(false);
  });

  it("rejects phone exceeding 50", () => {
    expect(createGuardianSchema.safeParse({ ...validExternal(), phone: "1".repeat(51) }).success).toBe(false);
  });

  it("rejects relationship exceeding 100", () => {
    expect(createGuardianSchema.safeParse({ ...validExternal(), relationship: "a".repeat(101) }).success).toBe(false);
  });

  it("rejects is_member true without member_user_id", () => {
    const result = createGuardianSchema.safeParse({ full_name: "X", is_member: true, member_user_id: null });
    expect(result.success).toBe(false);
  });

  it("rejects is_member true with invalid uuid", () => {
    const result = createGuardianSchema.safeParse({ full_name: "X", is_member: true, member_user_id: "bad-uuid" });
    expect(result.success).toBe(false);
  });

  it("rejects is_member false with member_user_id set", () => {
    const result = createGuardianSchema.safeParse({ ...validExternal(), is_member: false, member_user_id: VALID_UUID });
    expect(result.success).toBe(false);
  });

  it("rejects is_member false with invalid uuid", () => {
    // still rejected via coherence, but also uuid check
    const result = createGuardianSchema.safeParse({ full_name: "X", is_member: false, member_user_id: "not-uuid" });
    expect(result.success).toBe(false);
  });

  it("trims full_name", () => {
    const result = createGuardianSchema.safeParse({ ...validExternal(), full_name: "  María López  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.full_name).toBe("María López");
  });

  it("accepts external without optional fields at all", () => {
    expect(createGuardianSchema.safeParse({ full_name: "Solo Nombre", is_member: false }).success).toBe(true);
  });
});

describe("updateGuardianSchema", () => {
  it("requires valid uuid", () => {
    expect(updateGuardianSchema.safeParse({ ...validExternal(), id: "not-uuid" }).success).toBe(false);
  });

  it("accepts valid update with member", () => {
    expect(updateGuardianSchema.safeParse({ ...validMember(), id: VALID_UUID }).success).toBe(true);
  });

  it("rejects update with is_member mismatch", () => {
    const result = updateGuardianSchema.safeParse({ ...validMember(), id: VALID_UUID, is_member: false });
    // member_user_id still set -> should fail coherence
    expect(result.success).toBe(false);
  });
});

describe("assignGuardianSchema", () => {
  it("accepts valid assign", () => {
    expect(assignGuardianSchema.safeParse({ minor_id: VALID_UUID, guardian_id: OTHER_UUID }).success).toBe(true);
  });

  it("rejects invalid minor_id uuid", () => {
    expect(assignGuardianSchema.safeParse({ minor_id: "bad", guardian_id: OTHER_UUID }).success).toBe(false);
  });

  it("rejects invalid guardian_id uuid", () => {
    expect(assignGuardianSchema.safeParse({ minor_id: VALID_UUID, guardian_id: "bad" }).success).toBe(false);
  });

  it("rejects missing fields", () => {
    expect(assignGuardianSchema.safeParse({}).success).toBe(false);
  });
});

describe("unassignGuardianSchema", () => {
  it("accepts valid unassign", () => {
    expect(unassignGuardianSchema.safeParse({ minor_id: VALID_UUID }).success).toBe(true);
  });

  it("rejects invalid uuid", () => {
    expect(unassignGuardianSchema.safeParse({ minor_id: "bad" }).success).toBe(false);
  });
});

describe("setMinorStatusSchema", () => {
  it("accepts is_minor true without guardian", () => {
    expect(setMinorStatusSchema.safeParse({ user_id: VALID_UUID, is_minor: true }).success).toBe(true);
  });

  it("accepts is_minor true with guardian", () => {
    expect(
      setMinorStatusSchema.safeParse({ user_id: VALID_UUID, is_minor: true, legal_guardian_id: OTHER_UUID })
        .success,
    ).toBe(true);
  });

  it("accepts is_minor false", () => {
    expect(setMinorStatusSchema.safeParse({ user_id: VALID_UUID, is_minor: false }).success).toBe(true);
  });

  it("normalizes empty legal_guardian_id to null", () => {
    const result = setMinorStatusSchema.safeParse({ user_id: VALID_UUID, is_minor: true, legal_guardian_id: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.legal_guardian_id).toBeNull();
  });

  it("rejects invalid legal_guardian_id uuid", () => {
    expect(
      setMinorStatusSchema.safeParse({ user_id: VALID_UUID, is_minor: true, legal_guardian_id: "bad" }).success,
    ).toBe(false);
  });

  it("rejects invalid user_id", () => {
    expect(setMinorStatusSchema.safeParse({ user_id: "bad", is_minor: true }).success).toBe(false);
  });

  it("accepts legal_guardian_id null explicitly", () => {
    expect(
      setMinorStatusSchema.safeParse({ user_id: VALID_UUID, is_minor: false, legal_guardian_id: null }).success,
    ).toBe(true);
  });
});
