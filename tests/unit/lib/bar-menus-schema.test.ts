import { describe, it, expect } from "vitest";
import {
  createBarItemSchema,
  updateBarPriceSchema,
  updateStockSchema,
  updateVisibilitySchema,
  toggleAvailabilitySchema,
} from "@/lib/bar/menus";

describe("createBarItemSchema", () => {
  it("accepts valid input", () => {
    const r = createBarItemSchema.safeParse({ name: "Menu Paella", category: "menu", price: 12.5, stock_quantity: 10 });
    expect(r.success).toBe(true);
  });
  it("trims name", () => {
    const r = createBarItemSchema.safeParse({ name: "  Cerveza ", category: "drink", price: 2 });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data.name).toBe("Cerveza");
  });
  it("fails empty name", () => {
    expect(createBarItemSchema.safeParse({ name: "", category: "drink", price: 2 }).success).toBe(false);
  });
  it("fails name >200", () => {
    expect(createBarItemSchema.safeParse({ name: "a".repeat(201), category: "drink", price: 2 }).success).toBe(false);
  });
  it("fails invalid category", () => {
    expect(createBarItemSchema.safeParse({ name: "x", category: "postre" as never, price: 2 }).success).toBe(false);
  });
  it("fails price 0", () => {
    expect(createBarItemSchema.safeParse({ name: "x", category: "drink", price: 0 }).success).toBe(false);
  });
  it("fails negative stock", () => {
    expect(createBarItemSchema.safeParse({ name: "x", category: "drink", price: 2, stock_quantity: -1 }).success).toBe(false);
  });
  it("fails float stock", () => {
    expect(createBarItemSchema.safeParse({ name: "x", category: "drink", price: 2, stock_quantity: 1.5 }).success).toBe(false);
  });
});

describe("updateBarPriceSchema", () => {
  it("accepts valid", () => {
    expect(updateBarPriceSchema.safeParse({ id: "123e4567-e89b-12d3-a456-426614174000", price: 5 }).success).toBe(true);
  });
  it("fails 0", () => {
    expect(updateBarPriceSchema.safeParse({ id: "123e4567-e89b-12d3-a456-426614174000", price: 0 }).success).toBe(false);
  });
});

describe("updateStockSchema", () => {
  it("accepts 0", () => {
    expect(updateStockSchema.safeParse({ id: "123e4567-e89b-12d3-a456-426614174000", stock_quantity: 0 }).success).toBe(true);
  });
  it("fails float", () => {
    expect(updateStockSchema.safeParse({ id: "123e4567-e89b-12d3-a456-426614174000", stock_quantity: 1.5 }).success).toBe(false);
  });
});

describe("updateVisibilitySchema", () => {
  it("accepts boolean", () => {
    expect(updateVisibilitySchema.safeParse({ id: "123e4567-e89b-12d3-a456-426614174000", is_visible_to_members: true }).success).toBe(true);
  });
});

describe("toggleAvailabilitySchema", () => {
  it("accepts boolean", () => {
    expect(toggleAvailabilitySchema.safeParse({ id: "123e4567-e89b-12d3-a456-426614174000", is_available: false }).success).toBe(true);
  });
});
