import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import {
  createGuardian,
  updateGuardian,
  assignGuardian,
  unassignGuardian,
  setMinorStatus,
} from "@/lib/guardians/mutations";
import type { AuthenticatedProfile } from "@/types/auth";

const mockFrom = vi.fn();
const GUARDIAN_ID = "123e4567-e89b-12d3-a456-426614174001";
const OTHER_UUID = "123e4567-e89b-12d3-a456-426614174002";
const MINOR_ID = "123e4567-e89b-12d3-a456-426614174003";

function makeTableMock(selectResult: { data?: unknown; error?: Error | null } = { data: null, error: null }) {
  const resolveSingle = () =>
    Promise.resolve(
      Array.isArray(selectResult.data)
        ? { data: selectResult.data[0] ?? null, error: selectResult.error ?? null }
        : selectResult,
    );
  const selectThenable = Promise.resolve(selectResult);

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    order: vi.fn(() => builder),
    in: vi.fn(() => builder),
    gte: vi.fn(() => builder),
    lte: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    maybeSingle: vi.fn(resolveSingle),
    single: vi.fn(resolveSingle),
    then: (onfulfilled?: ((value: unknown) => unknown) | null, onrejected?: ((reason: unknown) => unknown) | null) =>
      selectThenable.then(onfulfilled as never, onrejected as never),
  };
  return builder;
}

function setupTables(tables: Record<string, { data?: unknown; error?: Error | null }> = {}) {
  const builders: Record<string, ReturnType<typeof makeTableMock>> = {};
  for (const key of ["legal_guardians", "profiles"]) {
    builders[key] = makeTableMock(tables[key] ?? { data: null, error: null });
  }
  mockFrom.mockImplementation((table: string) => builders[table] ?? makeTableMock({ data: null, error: null }));
  return builders;
}

function actor(role: AuthenticatedProfile["role"] = "super_admin"): AuthenticatedProfile {
  return {
    id: "actor-1",
    firstName: "Marta",
    lastName: "Admin",
    email: null,
    avatarUrl: null,
    role,
    componentType: "member",
    workgroup: "ninguno",
    isWorkgroupLead: false,
    componentLeadFor: null,
    birthDate: null,
    isActive: true,
    status: "active",
    username: null,
    authMethod: "google",
    bio: null,
    phone: null,
    skills: [],
    joinedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function validExternal() {
  return {
    full_name: "María López",
    document_id: "12345678A",
    email: "maria@example.com",
    phone: "+34 600 000 000",
    relationship: "Madre",
    is_member: false as const,
    member_user_id: null,
  };
}

function validMemberGuard() {
  return {
    full_name: "Juan Pérez",
    is_member: true as const,
    member_user_id: OTHER_UUID,
  };
}

async function expectRejectedAsMember(action: () => Promise<{ success: boolean; error?: string }>) {
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor("member"));
  const result = await action();
  expect(result.success).toBe(false);
  expect(result.error).toBe("Solo la directiva puede gestionar representantes.");
  expect(mockFrom).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue({ from: mockFrom } as unknown as ReturnType<typeof createClient>);
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor());
});

describe("createGuardian", () => {
  it("rejects non-management without touching DB", async () => {
    await expectRejectedAsMember(() => createGuardian(validExternal()));
  });

  it("creates external guardian with created_by", async () => {
    const builders = setupTables({ legal_guardians: { data: [{ id: "g1" }] } });
    const result = await createGuardian(validExternal());
    expect(result).toEqual({ success: true, id: "g1" });
    expect(builders.legal_guardians!.insert).toHaveBeenCalledWith({
      full_name: "María López",
      document_id: "12345678A",
      email: "maria@example.com",
      phone: "+34 600 000 000",
      relationship: "Madre",
      is_member: false,
      member_user_id: null,
      created_by: "actor-1",
    });
  });

  it("validates member existence when is_member", async () => {
    // member exists and valid
    const builders = setupTables({
      profiles: { data: [{ id: OTHER_UUID, is_active: true, status: "active", deleted_at: null, is_minor: false }] },
      legal_guardians: { data: [{ id: "g2" }] },
    });
    const result = await createGuardian(validMemberGuard());
    expect(result.success).toBe(true);
    expect(builders.legal_guardians!.insert).toHaveBeenCalledWith(
      expect.objectContaining({ is_member: true, member_user_id: OTHER_UUID }),
    );
  });

  it("rejects when member not available", async () => {
    setupTables({
      profiles: { data: [{ id: OTHER_UUID, is_active: false, status: "active", deleted_at: null, is_minor: false }] },
    });
    const result = await createGuardian(validMemberGuard());
    expect(result.success).toBe(false);
    expect(result.error).toBe("El miembro seleccionado ya no está disponible.");
  });

  it("normalizes empty optional to null", async () => {
    const builders = setupTables({ legal_guardians: { data: [{ id: "g3" }] } });
    const result = await createGuardian({ full_name: "Ana", is_member: false, member_user_id: null, email: "" } as never);
    expect(result.success).toBe(true);
    expect(builders.legal_guardians!.insert).toHaveBeenCalledWith(expect.objectContaining({ email: null }));
  });

  it("rejects invalid input without touching DB", async () => {
    const result = await createGuardian({ full_name: "", is_member: false } as never);
    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns raw error on failure", async () => {
    setupTables({ legal_guardians: { error: new Error("db boom"), data: null } });
    const result2 = await createGuardian(validExternal());
    expect(result2.success).toBe(false);
    expect(result2.error).toBe("db boom");
  });
});

describe("updateGuardian", () => {
  it("rejects non-management", async () => {
    await expectRejectedAsMember(() => updateGuardian({ ...validExternal(), id: GUARDIAN_ID }));
  });

  it("returns not found when missing", async () => {
    setupTables({ legal_guardians: { data: [] } });
    const result = await updateGuardian({ ...validExternal(), id: GUARDIAN_ID });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Representante no encontrado.");
  });

  it("updates when exists", async () => {
    const builders = setupTables({ legal_guardians: { data: [{ id: GUARDIAN_ID }] } });
    const result = await updateGuardian({ ...validExternal(), id: GUARDIAN_ID, full_name: "Nuevo Nombre" });
    expect(result).toEqual({ success: true });
    expect(builders.legal_guardians!.update).toHaveBeenCalledWith({
      full_name: "Nuevo Nombre",
      document_id: "12345678A",
      email: "maria@example.com",
      phone: "+34 600 000 000",
      relationship: "Madre",
      is_member: false,
      member_user_id: null,
    });
  });

  it("validates uuid", async () => {
    const result = await updateGuardian({ ...validExternal(), id: "bad" } as never);
    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("assignGuardian", () => {
  it("rejects non-management", async () => {
    await expectRejectedAsMember(() => assignGuardian({ minor_id: MINOR_ID, guardian_id: GUARDIAN_ID }));
  });

  it("returns not found for minor", async () => {
    setupTables({ profiles: { data: [] } });
    const result = await assignGuardian({ minor_id: MINOR_ID, guardian_id: GUARDIAN_ID });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Menor no encontrado.");
  });

  it("rejects when not is_minor", async () => {
    setupTables({ profiles: { data: [{ id: MINOR_ID, is_minor: false, deleted_at: null }] } });
    const result = await assignGuardian({ minor_id: MINOR_ID, guardian_id: GUARDIAN_ID });
    expect(result.success).toBe(false);
    expect(result.error).toBe("El perfil no está marcado como menor.");
  });

  it("returns not found for guardian", async () => {
    // sequential calls: first profile exists, then guardian missing
    // Need to mock from to return different results per table/call.
    // Use makeTableMock per table, but assign does two queries on different tables.
    // So profiles returns minor, legal_guardians returns empty.
    setupTables({
      profiles: { data: [{ id: MINOR_ID, is_minor: true, deleted_at: null }] },
      legal_guardians: { data: [] },
    });
    const result = await assignGuardian({ minor_id: MINOR_ID, guardian_id: GUARDIAN_ID });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Representante no encontrado.");
  });

  it("assigns when exists", async () => {
    const builders = setupTables({
      profiles: { data: [{ id: MINOR_ID, is_minor: true, deleted_at: null }] },
      legal_guardians: { data: [{ id: GUARDIAN_ID }] },
    });
    // Need profiles.update mock: builders.profiles will be used for update call.
    // After the maybeSingle calls, the update call uses same builder.
    const result = await assignGuardian({ minor_id: MINOR_ID, guardian_id: GUARDIAN_ID });
    expect(result).toEqual({ success: true });
    expect(builders.profiles!.update).toHaveBeenCalledWith({ legal_guardian_id: GUARDIAN_ID });
  });

  it("validates uuids", async () => {
    const result = await assignGuardian({ minor_id: "bad", guardian_id: GUARDIAN_ID } as never);
    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("unassignGuardian", () => {
  it("rejects non-management", async () => {
    await expectRejectedAsMember(() => unassignGuardian({ minor_id: MINOR_ID }));
  });

  it("returns not found when minor missing", async () => {
    setupTables({ profiles: { data: [] } });
    const result = await unassignGuardian({ minor_id: MINOR_ID });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Menor no encontrado.");
  });

  it("unassigns when exists", async () => {
    const builders = setupTables({ profiles: { data: [{ id: MINOR_ID }] } });
    const result = await unassignGuardian({ minor_id: MINOR_ID });
    expect(result).toEqual({ success: true });
    expect(builders.profiles!.update).toHaveBeenCalledWith({ legal_guardian_id: null });
  });

  it("rejects invalid uuid", async () => {
    const result = await unassignGuardian({ minor_id: "bad" } as never);
    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("setMinorStatus", () => {
  it("rejects non-management", async () => {
    await expectRejectedAsMember(() => setMinorStatus({ user_id: MINOR_ID, is_minor: true }));
  });

  it("returns not found when profile missing", async () => {
    setupTables({ profiles: { data: [] } });
    const result = await setMinorStatus({ user_id: MINOR_ID, is_minor: true });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Perfil no encontrado.");
  });

  it("sets is_minor true without guardian", async () => {
    const builders = setupTables({ profiles: { data: [{ id: MINOR_ID }] } });
    const result = await setMinorStatus({ user_id: MINOR_ID, is_minor: true });
    expect(result).toEqual({ success: true });
    expect(builders.profiles!.update).toHaveBeenCalledWith({ is_minor: true, legal_guardian_id: null });
  });

  it("sets is_minor false clears guardian", async () => {
    const builders = setupTables({ profiles: { data: [{ id: MINOR_ID }] } });
    const result = await setMinorStatus({ user_id: MINOR_ID, is_minor: false, legal_guardian_id: GUARDIAN_ID });
    expect(result).toEqual({ success: true });
    expect(builders.profiles!.update).toHaveBeenCalledWith({ is_minor: false, legal_guardian_id: null });
  });

  it("validates guardian exists when provided", async () => {
    setupTables({
      profiles: { data: [{ id: MINOR_ID }] },
      legal_guardians: { data: [] },
    });
    const result = await setMinorStatus({ user_id: MINOR_ID, is_minor: true, legal_guardian_id: GUARDIAN_ID });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Representante no encontrado.");
  });

  it("rejects invalid uuid", async () => {
    const result = await setMinorStatus({ user_id: "bad", is_minor: true } as never);
    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
