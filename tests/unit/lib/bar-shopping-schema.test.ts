import { describe, it, expect } from "vitest";
import { createShoppingListSchema, addShoppingItemSchema } from "@/lib/bar/shopping";

describe("createShoppingListSchema", () => {
  it("accepts valid title", () => {
    expect(createShoppingListSchema.safeParse({ title: "Compra semanal" }).success).toBe(true);
  });
  it("fails empty", () => {
    expect(createShoppingListSchema.safeParse({ title: "" }).success).toBe(false);
  });
  it("fails >200", () => {
    expect(createShoppingListSchema.safeParse({ title: "a".repeat(201) }).success).toBe(false);
  });
});

describe("addShoppingItemSchema", () => {
  const listId = "123e4567-e89b-12d3-a456-426614174000";
  it("accepts valid", () => {
    expect(addShoppingItemSchema.safeParse({ shopping_list_id: listId, name: "Cervezas", quantity_needed: 5 }).success).toBe(true);
  });
  it("fails quantity 0", () => {
    expect(addShoppingItemSchema.safeParse({ shopping_list_id: listId, name: "x", quantity_needed: 0 }).success).toBe(false);
  });
  it("fails empty name", () => {
    expect(addShoppingItemSchema.safeParse({ shopping_list_id: listId, name: "", quantity_needed: 1 }).success).toBe(false);
  });
  it("accepts optional bar_item_id null", () => {
    expect(addShoppingItemSchema.safeParse({ shopping_list_id: listId, bar_item_id: null, name: "Pan", quantity_needed: 2 }).success).toBe(true);
  });
});
