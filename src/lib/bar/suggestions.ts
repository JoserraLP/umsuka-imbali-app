import type { BarCategory } from "@/types/database.types";

/**
 * Suggests quantity_needed based on stock_quantity.
 * Thresholds (adjustable by barra lead):
 *   stock <= 0  -> 20 (out of stock, full replenishment)
 *   stock <= 5  -> 15 (critical)
 *   stock <=10  -> 10 (low)
 *   stock <=20  -> 5  (medium)
 *   stock >20   -> 0  (sufficient, no suggestion)
 * If stock is null/undefined -> 10 (default).
 */
export function suggestQuantity(stockQuantity: number | null | undefined): number {
  if (stockQuantity === null || stockQuantity === undefined) return 10;
  if (stockQuantity <= 0) return 20;
  if (stockQuantity <= 5) return 15;
  if (stockQuantity <= 10) return 10;
  if (stockQuantity <= 20) return 5;
  return 0;
}

export function suggestQuantityByCategory(
  stock: number | null | undefined,
  category: BarCategory | null | undefined,
): number {
  const base = suggestQuantity(stock);
  if (category === "drink" && base > 0) return Math.min(base + 5, 25);
  return base;
}
