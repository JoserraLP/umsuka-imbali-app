import { describe, it, expect } from "vitest";
import { isPaidForMonth } from "@/lib/payments/queries";

describe("payments queries pure helpers", () => {
  describe("isPaidForMonth", () => {
    it("yearly payment covers any month of that year", () => {
      const payments = [{ payment_type: "yearly" as const, period_month: null, period_year: 2026 }];
      expect(isPaidForMonth(payments, 2026, 1)).toBe(true);
      expect(isPaidForMonth(payments, 2026, 12)).toBe(true);
      expect(isPaidForMonth(payments, 2026, 6)).toBe(true);
    });

    it("yearly does not cover other years", () => {
      const payments = [{ payment_type: "yearly" as const, period_month: null, period_year: 2025 }];
      expect(isPaidForMonth(payments, 2026, 5)).toBe(false);
    });

    it("monthly covers exact month/year", () => {
      const payments = [{ payment_type: "monthly" as const, period_month: 5, period_year: 2026 }];
      expect(isPaidForMonth(payments, 2026, 5)).toBe(true);
      expect(isPaidForMonth(payments, 2026, 6)).toBe(false);
      expect(isPaidForMonth(payments, 2025, 5)).toBe(false);
    });

    it("combines yearly and monthly", () => {
      const payments = [
        { payment_type: "monthly" as const, period_month: 3, period_year: 2026 },
        { payment_type: "yearly" as const, period_month: null, period_year: 2025 },
      ];
      expect(isPaidForMonth(payments, 2026, 3)).toBe(true);
      expect(isPaidForMonth(payments, 2025, 8)).toBe(true);
      expect(isPaidForMonth(payments, 2026, 4)).toBe(false);
    });

    it("empty list returns false", () => {
      expect(isPaidForMonth([], 2026, 5)).toBe(false);
    });

    it("multiple payments where one matches yearly", () => {
      const payments = [
        { payment_type: "monthly" as const, period_month: 1, period_year: 2026 },
        { payment_type: "yearly" as const, period_month: null, period_year: 2026 },
      ];
      expect(isPaidForMonth(payments, 2026, 9)).toBe(true);
    });
  });
});
