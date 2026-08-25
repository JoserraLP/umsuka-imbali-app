import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { createTransaction, updateTransaction, deleteTransaction } from "@/lib/finances/mutations";
import type { AuthenticatedProfile } from "@/types/auth";

const mockFrom = vi.fn();
const TRANSACTION_ID = "123e4567-e89b-12d3-a456-426614174001";

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
  for (const key of ["transactions", "profiles"]) {
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

function validCreate() {
  return {
    type: "income" as const,
    category: "bar_shift" as const,
    amount: 150.5,
    description: "Turno barra",
    transaction_date: "2026-03-15",
  };
}

async function expectRejectedAsMember(action: () => Promise<{ success: boolean; error?: string }>) {
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor("member"));
  const result = await action();
  expect(result.success).toBe(false);
  expect(result.error).toBe("Solo la directiva puede gestionar las finanzas.");
  expect(mockFrom).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue({ from: mockFrom } as unknown as ReturnType<typeof createClient>);
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor());
});

describe("createTransaction", () => {
  it("rejects non-management members without touching DB", async () => {
    await expectRejectedAsMember(() => createTransaction(validCreate()));
  });

  it("creates transaction with created_by", async () => {
    const builders = setupTables({ transactions: { data: [{ id: "tx-1" }] } });
    const result = await createTransaction(validCreate());
    expect(result).toEqual({ success: true, id: "tx-1" });
    expect(builders.transactions!.insert).toHaveBeenCalledWith({
      type: "income",
      category: "bar_shift",
      amount: 150.5,
      description: "Turno barra",
      transaction_date: "2026-03-15",
      created_by: "actor-1",
    });
  });

  it("normalizes empty description to null", async () => {
    const builders = setupTables({ transactions: { data: [{ id: "tx-1" }] } });
    const result = await createTransaction({ ...validCreate(), description: "" });
    expect(result.success).toBe(true);
    expect(builders.transactions!.insert).toHaveBeenCalledWith(expect.objectContaining({ description: null }));
  });

  it("rejects invalid input without touching DB", async () => {
    const result = await createTransaction({ ...validCreate(), amount: -5 } as never);
    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("returns raw error on failure", async () => {
    setupTables({ transactions: { error: new Error("db boom"), data: null } });
    const result = await createTransaction(validCreate());
    expect(result.success).toBe(false);
    expect(result.error).toBe("db boom");
  });
});

describe("updateTransaction", () => {
  it("rejects non-management", async () => {
    await expectRejectedAsMember(() => updateTransaction({ ...validCreate(), id: TRANSACTION_ID }));
  });

  it("returns not found when missing", async () => {
    setupTables({ transactions: { data: [] } });
    const result = await updateTransaction({ ...validCreate(), id: TRANSACTION_ID });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Transacción no encontrada.");
  });

  it("updates when exists", async () => {
    const builders = setupTables({ transactions: { data: [{ id: TRANSACTION_ID }] } });
    const result = await updateTransaction({ ...validCreate(), id: TRANSACTION_ID, amount: 200 });
    expect(result).toEqual({ success: true });
    expect(builders.transactions!.update).toHaveBeenCalledWith({
      type: "income",
      category: "bar_shift",
      amount: 200,
      description: "Turno barra",
      transaction_date: "2026-03-15",
    });
  });

  it("validates uuid", async () => {
    const result = await updateTransaction({ ...validCreate(), id: "bad" } as never);
    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

describe("deleteTransaction", () => {
  it("rejects non-management", async () => {
    await expectRejectedAsMember(() => deleteTransaction({ id: TRANSACTION_ID }));
  });

  it("returns not found when missing", async () => {
    setupTables({ transactions: { data: [] } });
    const result = await deleteTransaction({ id: TRANSACTION_ID });
    expect(result.success).toBe(false);
    expect(result.error).toBe("Transacción no encontrada.");
  });

  it("deletes when exists", async () => {
    const builders = setupTables({ transactions: { data: [{ id: TRANSACTION_ID }] } });
    const result = await deleteTransaction({ id: TRANSACTION_ID });
    expect(result).toEqual({ success: true });
    expect(builders.transactions!.delete).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid uuid", async () => {
    const result = await deleteTransaction({ id: "bad" } as never);
    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });
});
