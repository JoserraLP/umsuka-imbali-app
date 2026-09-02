"use server";

import { revalidatePath } from "next/cache";
import {
  createBarItem,
  updateBarPrice,
  updateStock,
  toggleAvailability,
  toggleVisibility,
} from "@/lib/bar/menus";
import type {
  CreateBarItemInput,
  UpdateBarPriceInput,
  UpdateStockInput,
  ToggleAvailabilityInput,
  UpdateVisibilityInput,
} from "@/lib/bar/menus";
import {
  createShoppingList,
  addItemToShoppingList,
  toggleShoppingItemChecked,
  closeShoppingList,
  updateShoppingItemQuantity,
  deleteShoppingItem,
  deleteShoppingList,
} from "@/lib/bar/shopping";
import type {
  CreateShoppingListInput,
  AddShoppingItemInput,
  ToggleCheckedInput,
  CloseShoppingListInput,
  UpdateQuantityInput,
} from "@/lib/bar/shopping";

export async function createBarItemAction(input: CreateBarItemInput) {
  const result = await createBarItem(input);
  if (result.success) {
    revalidatePath("/bar");
    revalidatePath("/bar/admin");
  }
  return result;
}

export async function updateBarPriceAction(input: UpdateBarPriceInput) {
  const result = await updateBarPrice(input);
  if (result.success) {
    revalidatePath("/bar");
    revalidatePath("/bar/admin");
  }
  return result;
}

export async function updateStockAction(input: UpdateStockInput) {
  const result = await updateStock(input);
  if (result.success) {
    revalidatePath("/bar");
    revalidatePath("/bar/admin");
  }
  return result;
}

export async function toggleBarItemAvailabilityAction(input: ToggleAvailabilityInput) {
  const result = await toggleAvailability(input);
  if (result.success) {
    revalidatePath("/bar");
    revalidatePath("/bar/admin");
  }
  return result;
}

export async function toggleBarItemVisibilityAction(input: UpdateVisibilityInput) {
  const result = await toggleVisibility(input);
  if (result.success) {
    revalidatePath("/bar");
    revalidatePath("/bar/admin");
  }
  return result;
}

export async function createShoppingListAction(input: CreateShoppingListInput) {
  const result = await createShoppingList(input);
  if (result.success) revalidatePath("/bar/admin");
  return result;
}

export async function addShoppingItemAction(input: AddShoppingItemInput) {
  const result = await addItemToShoppingList(input);
  if (result.success) revalidatePath("/bar/admin");
  return result;
}

export async function toggleShoppingItemAction(input: ToggleCheckedInput) {
  const result = await toggleShoppingItemChecked(input);
  if (result.success) revalidatePath("/bar/admin");
  return result;
}

export async function closeShoppingListAction(input: CloseShoppingListInput) {
  const result = await closeShoppingList(input);
  if (result.success) revalidatePath("/bar/admin");
  return result;
}

export async function updateShoppingItemQuantityAction(input: UpdateQuantityInput) {
  const result = await updateShoppingItemQuantity(input);
  if (result.success) revalidatePath("/bar/admin");
  return result;
}

export async function deleteShoppingItemAction(input: { id: string }) {
  const result = await deleteShoppingItem(input);
  if (result.success) revalidatePath("/bar/admin");
  return result;
}

export async function deleteShoppingListAction(input: { id: string }) {
  const result = await deleteShoppingList(input);
  if (result.success) revalidatePath("/bar/admin");
  return result;
}
