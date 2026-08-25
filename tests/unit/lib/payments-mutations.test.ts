import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { registerPayment, updatePayment, deletePayment, bulkRegisterMonthly } from "@/lib/payments/mutations";
import type { AuthenticatedProfile } from "@/types/auth";

const mockFrom = vi.fn();
const VALID_UUID = "11111111-1111-4111-8111-111111111111";
const TARGET_UUID = "22222222-2222-4222-8222-222222222222";

function makeTableMock(result: { data?: unknown; error?: Error | null } = { data: null, error: null }) {
  const resolveSingle = () =>
    Promise.resolve(
      Array.isArray(result.data)
        ? { data: (result.data as unknown[])[0] ?? null, error: result.error ?? null }
        : result,
    );
  const thenable = Promise.resolve(result);
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    order: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    maybeSingle: vi.fn(resolveSingle),
    single: vi.fn(resolveSingle),
    then: (onfulfilled?: ((value: unknown) => unknown) | null, onrejected?: ((reason: unknown) => unknown) | null) =>
      thenable.then(onfulfilled as never, onrejected as never),
  };
  return builder;
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

function setup(tables: Record<string, { data?: unknown; error?: Error | null }> = {}) {
  const builders: Record<string, ReturnType<typeof makeTableMock>> = {};
  for (const key of ["member_payments", "profiles"]) {
    builders[key] = makeTableMock(tables[key] ?? { data: null, error: null });
  }
  mockFrom.mockImplementation((table: string) => builders[table] ?? makeTableMock({ data: null, error: null }));
  return builders;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue({ from: mockFrom } as unknown as ReturnType<typeof createClient>);
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor());
});

describe("payments mutations", () => {
  it("registerPayment rejects member without DB", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor("member"));
    const res = await registerPayment({
      user_id: VALID_UUID,
      payment_type: "monthly",
      period_month: 5,
      period_year: 2026,
      amount: 25 as never,
      paid_at: "2026-05-10",
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/directiva/);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("registerPayment validates Zod before DB", async () => {
    const res = await registerPayment({
      user_id: VALID_UUID,
      payment_type: "monthly",
      period_month: null as never,
      period_year: 2026,
      amount: 25 as never,
      paid_at: "2026-05-10",
    } as never);
    expect(res.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("registerPayment creates with registered_by and null notes", async () => {
    const builders = setup({
      profiles: { data: [{ id: VALID_UUID, deleted_at: null }] },
      member_payments: { data: [{ id: "new-id" }] },
    });
    const res = await registerPayment({
      user_id: VALID_UUID,
      payment_type: "monthly",
      period_month: 5,
      period_year: 2026,
      amount: 25 as never,
      paid_at: "2026-05-10",
      notes: "   ",
    } as never);
    expect(res.success).toBe(true);
    expect(res.id).toBe("new-id");
    expect(builders.member_payments!.insert).toHaveBeenCalledWith({
      user_id: VALID_UUID,
      payment_type: "monthly",
      period_month: 5,
      period_year: 2026,
      amount: 25,
      paid_at: "2026-05-10",
      registered_by: "actor-1",
      notes: null,
    });
  });

  it("registerPayment maps unique violation", async () => {
    setup({
      profiles: { data: [{ id: VALID_UUID, deleted_at: null }] },
      member_payments: { error: new Error("duplicate key value violates unique constraint uniq_member_monthly_payment"), data: null },
    });
    const res = await registerPayment({
      user_id: VALID_UUID,
      payment_type: "monthly",
      period_month: 5,
      period_year: 2026,
      amount: 25 as never,
      paid_at: "2026-05-10",
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/Ya existe un pago/);
  });

  it("registerPayment rejects deleted member", async () => {
    setup({ profiles: { data: [{ id: VALID_UUID, deleted_at: "2026-01-01" }] } });
    const res = await registerPayment({
      user_id: VALID_UUID,
      payment_type: "monthly",
      period_month: 5,
      period_year: 2026,
      amount: 25 as never,
      paid_at: "2026-05-10",
    } as never);
    expect(res.success).toBe(false);
    expect(res.error).toMatch(/no está disponible/);
  });

  it("updatePayment rejects member and not-found", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor("member"));
    const r1 = await updatePayment({
      id: VALID_UUID,
      user_id: VALID_UUID,
      payment_type: "monthly",
      period_month: 5,
      period_year: 2026,
      amount: 25 as never,
      paid_at: "2026-05-10",
    } as never);
    expect(r1.success).toBe(false);

    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor());
    setup({ member_payments: { data: [] } });
    const r2 = await updatePayment({
      id: VALID_UUID,
      user_id: VALID_UUID,
      payment_type: "monthly",
      period_month: 5,
      period_year: 2026,
      amount: 25 as never,
      paid_at: "2026-05-10",
    } as never);
    expect(r2.success).toBe(false);
    expect(r2.error).toMatch(/no encontrado/);
  });

  it("updatePayment succeeds", async () => {
    const builders = setup({ member_payments: { data: [{ id: VALID_UUID }] } });
    const res = await updatePayment({
      id: VALID_UUID,
      user_id: VALID_UUID,
      payment_type: "yearly",
      period_month: null,
      period_year: 2026,
      amount: 120 as never,
      paid_at: "2026-01-01",
    } as never);
    expect(res.success).toBe(true);
    expect(builders.member_payments!.update).toHaveBeenCalled();
  });

  it("deletePayment validates uuid", async () => {
    const bad = await deletePayment({ id: "bad" } as never);
    expect(bad.success).toBe(false);
  });

  it("deletePayment not-found", async () => {
    setup({ member_payments: { data: [] } });
    const res = await deletePayment({ id: VALID_UUID } as never);
    expect(res.success).toBe(false);
  });

  it("bulk skips duplicates", async () => {
    // Need to simulate per-iteration insert results. We'll make from return builder that on single
    // resolves differently per call. Simpler: let bulk loop call insert().select().single() twice,
    // we mock member_payments builder's single to return success then duplicate error.
    // Our makeTableMock returns same result for all calls. So we need custom mock for this test.
    let call = 0;
    const singleMock = vi.fn(async () => {
      call += 1;
      if (call === 1) return { data: { id: "id1" }, error: null };
      return { data: null, error: { message: "duplicate key value violates unique constraint uniq_member_monthly_payment" } };
    });
    const builder = {
      select: vi.fn(() => builder),
      insert: vi.fn(() => builder),
      maybeSingle: vi.fn(async () => ({ data: null, error: null })),
      single: singleMock,
    };
    mockFrom.mockImplementation(() => builder as never);
    // Need profiles guard not used in bulk (no profile check), only is_management

    const res = await bulkRegisterMonthly({
      user_ids: [VALID_UUID, TARGET_UUID],
      period_month: 5,
      period_year: 2026,
      amount: 25 as never,
      paid_at: "2026-05-10",
    } as never);

    expect(res.created).toBe(1);
    expect(res.skipped).toBe(1);
  });

  it("bulk rejects member", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor("member"));
    const res = await bulkRegisterMonthly({
      user_ids: [VALID_UUID],
      period_month: 5,
      period_year: 2026,
      amount: 25 as never,
      paid_at: "2026-05-10",
    } as never);
    expect(res.success).toBe(false);
  });
});
