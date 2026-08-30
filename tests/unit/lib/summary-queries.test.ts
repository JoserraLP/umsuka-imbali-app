import { describe, it, expect } from "vitest";
import { isPaidForMonth } from "@/lib/payments/queries";

describe("summary / payment reuse isPaidForMonth", () => {
  it("detecta al día por pago mensual exacto", () => {
    expect(isPaidForMonth([{ payment_type: "monthly", period_month: 3, period_year: 2026 }], 2026, 3)).toBe(true);
    expect(isPaidForMonth([{ payment_type: "monthly", period_month: 2, period_year: 2026 }], 2026, 3)).toBe(false);
  });
  it("detecta al día por pago anual", () => {
    expect(isPaidForMonth([{ payment_type: "yearly", period_month: null, period_year: 2026 }], 2026, 5)).toBe(true);
    expect(isPaidForMonth([{ payment_type: "yearly", period_month: null, period_year: 2025 }], 2026, 5)).toBe(false);
  });
  it("mezcla mensual y anual", () => {
    expect(isPaidForMonth([{ payment_type: "monthly", period_month: 1, period_year: 2026 } as never, { payment_type: "yearly", period_month: null, period_year: 2025 } as never], 2025, 6)).toBe(true);
  });
});
