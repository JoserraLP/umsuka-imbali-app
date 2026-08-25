import { describe, it, expect } from "vitest";
import {
  createTransactionSchema,
  updateTransactionSchema,
  filterSchema,
  deleteTransactionSchema,
} from "@/lib/finances/schema";

const VALID_DATE = "2026-03-15";

function validCreate() {
  return {
    type: "income" as const,
    category: "bar_shift" as const,
    amount: 150.5,
    description: "Turno barra sábado",
    transaction_date: VALID_DATE,
  };
}

describe("createTransactionSchema", () => {
  it("accepts a valid income transaction", () => {
    expect(createTransactionSchema.safeParse(validCreate()).success).toBe(true);
  });

  it("accepts expense with other category and empty description normalized", () => {
    const result = createTransactionSchema.safeParse({
      ...validCreate(),
      type: "expense",
      category: "other",
      description: "   ",
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBeNull();
  });

  it("rejects invalid type", () => {
    const result = createTransactionSchema.safeParse({ ...validCreate(), type: "profit" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid category", () => {
    const result = createTransactionSchema.safeParse({ ...validCreate(), category: "invalid" });
    expect(result.success).toBe(false);
  });

  it("rejects amount zero", () => {
    const result = createTransactionSchema.safeParse({ ...validCreate(), amount: 0 });
    expect(result.success).toBe(false);
  });

  it("rejects negative amount", () => {
    const result = createTransactionSchema.safeParse({ ...validCreate(), amount: -5 });
    expect(result.success).toBe(false);
  });

  it("rejects amount with more than 2 decimals", () => {
    const result = createTransactionSchema.safeParse({ ...validCreate(), amount: 10.001 });
    expect(result.success).toBe(false);
  });

  it("rejects amount exceeding max", () => {
    const result = createTransactionSchema.safeParse({ ...validCreate(), amount: 100000000 });
    expect(result.success).toBe(false);
  });

  it("coerces string amount", () => {
    const result = createTransactionSchema.safeParse({ ...validCreate(), amount: "99.99" as unknown as number });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.amount).toBe(99.99);
  });

  it("rejects description exceeding 2000", () => {
    const result = createTransactionSchema.safeParse({ ...validCreate(), description: "a".repeat(2001) });
    expect(result.success).toBe(false);
  });

  it("rejects invalid transaction_date", () => {
    const result = createTransactionSchema.safeParse({ ...validCreate(), transaction_date: "2026-02-30" });
    expect(result.success).toBe(false);
  });

  it("rejects empty transaction_date", () => {
    const result = createTransactionSchema.safeParse({ ...validCreate(), transaction_date: "" });
    expect(result.success).toBe(false);
  });

  it("trims description empty to null", () => {
    const result = createTransactionSchema.safeParse({ ...validCreate(), description: "" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.description).toBeNull();
  });
});

describe("updateTransactionSchema", () => {
  it("requires valid uuid", () => {
    const result = updateTransactionSchema.safeParse({ ...validCreate(), id: "not-uuid" });
    expect(result.success).toBe(false);
  });

  it("accepts valid update", () => {
    const result = updateTransactionSchema.safeParse({
      ...validCreate(),
      id: "123e4567-e89b-12d3-a456-426614174001",
    });
    expect(result.success).toBe(true);
  });
});

describe("deleteTransactionSchema", () => {
  it("rejects invalid uuid", () => {
    expect(deleteTransactionSchema.safeParse({ id: "bad" }).success).toBe(false);
  });
  it("accepts valid uuid", () => {
    expect(deleteTransactionSchema.safeParse({ id: "123e4567-e89b-12d3-a456-426614174001" }).success).toBe(true);
  });
});

describe("filterSchema", () => {
  it("accepts empty filters", () => {
    expect(filterSchema.safeParse({}).success).toBe(true);
  });

  it("accepts valid from/to", () => {
    expect(filterSchema.safeParse({ from: "2026-01-01", to: "2026-12-31" }).success).toBe(true);
  });

  it("rejects from > to", () => {
    const result = filterSchema.safeParse({ from: "2026-12-31", to: "2026-01-01" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid date format", () => {
    const result = filterSchema.safeParse({ from: "01-01-2026" });
    expect(result.success).toBe(false);
  });

  it("accepts type and category filters", () => {
    expect(filterSchema.safeParse({ type: "income", category: "bar_shift" }).success).toBe(true);
  });

  it("rejects invalid type", () => {
    const result = filterSchema.safeParse({ type: "profit" as never });
    expect(result.success).toBe(false);
  });
});
