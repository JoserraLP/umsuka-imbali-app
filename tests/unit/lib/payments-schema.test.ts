import { describe, it, expect } from "vitest";
import {
  registerPaymentSchema,
  updatePaymentSchema,
  deletePaymentSchema,
  bulkRegisterMonthlySchema,
  formatPaymentPeriod,
} from "@/lib/payments/schema";

describe("payments schema", () => {
  const uuid = "11111111-1111-4111-8111-111111111111";
  const uuid2 = "22222222-2222-4222-8222-222222222222";

  describe("registerPaymentSchema", () => {
    it("accepts monthly with 1-12", () => {
      const parsed = registerPaymentSchema.safeParse({
        user_id: uuid,
        payment_type: "monthly",
        period_month: 5,
        period_year: 2026,
        amount: 25,
        paid_at: "2026-05-10",
        notes: "",
      });
      expect(parsed.success).toBe(true);
    });

    it("accepts yearly with null month", () => {
      const parsed = registerPaymentSchema.safeParse({
        user_id: uuid,
        payment_type: "yearly",
        period_month: null,
        period_year: 2026,
        amount: 120,
        paid_at: "2026-01-01",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects monthly without month", () => {
      const parsed = registerPaymentSchema.safeParse({
        user_id: uuid,
        payment_type: "monthly",
        period_month: null,
        period_year: 2026,
        amount: 25,
        paid_at: "2026-05-10",
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects monthly with 0 or 13", () => {
      for (const m of [0, 13]) {
        const parsed = registerPaymentSchema.safeParse({
          user_id: uuid,
          payment_type: "monthly",
          period_month: m,
          period_year: 2026,
          amount: 25,
          paid_at: "2026-05-10",
        });
        expect(parsed.success).toBe(false);
      }
    });

    it("rejects yearly with month set", () => {
      const parsed = registerPaymentSchema.safeParse({
        user_id: uuid,
        payment_type: "yearly",
        period_month: 5,
        period_year: 2026,
        amount: 120,
        paid_at: "2026-01-01",
      });
      expect(parsed.success).toBe(false);
    });

    it("rejects negative amount and >2 decimals", () => {
      const neg = registerPaymentSchema.safeParse({
        user_id: uuid,
        payment_type: "monthly",
        period_month: 5,
        period_year: 2026,
        amount: -5,
        paid_at: "2026-05-10",
      });
      expect(neg.success).toBe(false);

      const decimals = registerPaymentSchema.safeParse({
        user_id: uuid,
        payment_type: "monthly",
        period_month: 5,
        period_year: 2026,
        amount: 10.123,
        paid_at: "2026-05-10",
      });
      expect(decimals.success).toBe(false);
    });

    it("rejects invalid date", () => {
      const parsed = registerPaymentSchema.safeParse({
        user_id: uuid,
        payment_type: "monthly",
        period_month: 5,
        period_year: 2026,
        amount: 25,
        paid_at: "2026-13-01",
      });
      expect(parsed.success).toBe(false);
    });

    it("notes trim empty to null and validates length", () => {
      const parsed = registerPaymentSchema.safeParse({
        user_id: uuid,
        payment_type: "monthly",
        period_month: 5,
        period_year: 2026,
        amount: 25,
        paid_at: "2026-05-10",
        notes: "   ",
      });
      expect(parsed.success).toBe(true);
      if (parsed.success) expect(parsed.data.notes).toBeNull();

      const long = registerPaymentSchema.safeParse({
        user_id: uuid,
        payment_type: "monthly",
        period_month: 5,
        period_year: 2026,
        amount: 25,
        paid_at: "2026-05-10",
        notes: "a".repeat(2001),
      });
      expect(long.success).toBe(false);
    });

    it("rejects invalid uuid", () => {
      const parsed = registerPaymentSchema.safeParse({
        user_id: "not-uuid",
        payment_type: "monthly",
        period_month: 5,
        period_year: 2026,
        amount: 25,
        paid_at: "2026-05-10",
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("updatePaymentSchema", () => {
    it("requires id uuid", () => {
      const parsed = updatePaymentSchema.safeParse({
        id: "bad",
        user_id: uuid,
        payment_type: "monthly",
        period_month: 5,
        period_year: 2026,
        amount: 25,
        paid_at: "2026-05-10",
      });
      expect(parsed.success).toBe(false);
    });

    it("accepts valid update", () => {
      const parsed = updatePaymentSchema.safeParse({
        id: uuid,
        user_id: uuid,
        payment_type: "yearly",
        period_month: null,
        period_year: 2026,
        amount: 120,
        paid_at: "2026-01-01",
      });
      expect(parsed.success).toBe(true);
    });
  });

  describe("deletePaymentSchema", () => {
    it("validates uuid", () => {
      expect(deletePaymentSchema.safeParse({ id: uuid }).success).toBe(true);
      expect(deletePaymentSchema.safeParse({ id: "bad" }).success).toBe(false);
    });
  });

  describe("bulkRegisterMonthlySchema", () => {
    it("requires at least one user", () => {
      const parsed = bulkRegisterMonthlySchema.safeParse({
        user_ids: [],
        period_month: 5,
        period_year: 2026,
        amount: 25,
        paid_at: "2026-05-10",
      });
      expect(parsed.success).toBe(false);
    });

    it("accepts valid bulk", () => {
      const parsed = bulkRegisterMonthlySchema.safeParse({
        user_ids: [uuid, uuid2],
        period_month: 5,
        period_year: 2026,
        amount: 25,
        paid_at: "2026-05-10",
        notes: "cuota mayo",
      });
      expect(parsed.success).toBe(true);
    });

    it("rejects invalid month/year", () => {
      const parsed = bulkRegisterMonthlySchema.safeParse({
        user_ids: [uuid],
        period_month: 13,
        period_year: 0,
        amount: 25,
        paid_at: "2026-05-10",
      });
      expect(parsed.success).toBe(false);
    });
  });

  describe("formatPaymentPeriod", () => {
    it("formats monthly", () => {
      expect(formatPaymentPeriod({ payment_type: "monthly", period_month: 5, period_year: 2026 })).toBe("Mayo 2026");
    });
    it("formats yearly", () => {
      expect(formatPaymentPeriod({ payment_type: "yearly", period_month: null, period_year: 2026 })).toBe("Año 2026");
    });
  });

  describe("isPaidForMonth helper logic via schema coherence", () => {
    // This is also tested in queries pure test; here just sanity.
    it("yearly covers any month", async () => {
      const { isPaidForMonth } = await import("@/lib/payments/queries");
      expect(isPaidForMonth([{ payment_type: "yearly", period_month: null, period_year: 2026 }], 2026, 5)).toBe(true);
      expect(isPaidForMonth([{ payment_type: "yearly", period_month: null, period_year: 2025 }], 2026, 5)).toBe(false);
    });
  });
});
