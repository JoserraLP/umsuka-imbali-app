import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { canManageBar } from "@/lib/bar/authorization";
import type { BarCategory, BarShoppingStatus } from "@/types/database.types";
import { mapBarItemRow } from "@/lib/bar/menus";

// ── Types ─────────────────────────────────────────────────

export type ShoppingStatus = BarShoppingStatus;

export interface ShoppingItem {
  id: string;
  shoppingListId: string;
  barItemId: string | null;
  name: string;
  quantityNeeded: number;
  quantityPurchased: number;
  isChecked: boolean;
  notes: string | null;
  createdAt: string;
  stockQuantity?: number | null;
  category?: BarCategory | null;
  price?: number | null;
}

export interface ShoppingList {
  id: string;
  title: string;
  status: ShoppingStatus;
  createdBy: string | null;
  createdAt: string;
  closedAt: string | null;
  items: ShoppingItem[];
  progress: { total: number; checked: number; percent: number };
}

export interface ShoppingListSummary {
  id: string;
  title: string;
  status: ShoppingStatus;
  createdBy: string | null;
  createdAt: string;
  closedAt: string | null;
  total: number;
  checked: number;
  percent: number;
}

export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
}

// ── Pure logic: suggestQuantity ───────────────────────────

/**
 * Sugiere quantity_needed basándose en stock_quantity actual.
 * Umbrales provisionales (ajustables por responsable):
 *   stock <= 0  -> 20
 *   stock <= 5  -> 15
 *   stock <=10  -> 10
 *   stock <=20  -> 5
 *   stock >20   -> 0
 * Si stock es null/undefined -> 10 (default).
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

// ── Schemas Zod ───────────────────────────────────────────

export const createShoppingListSchema = z.object({
  title: z.string().trim().min(1, "El título es obligatorio.").max(200, "Máximo 200 caracteres."),
});

export type CreateShoppingListInput = z.infer<typeof createShoppingListSchema>;

export const addShoppingItemSchema = z
  .object({
    shopping_list_id: z.string().uuid("ID de lista no válido."),
    bar_item_id: z.string().uuid("ID de producto no válido.").nullable().optional(),
    name: z.string().trim().min(1, "El nombre es obligatorio.").max(200),
    quantity_needed: z.number().int().positive("La cantidad debe ser > 0.").max(9999),
    notes: z.string().trim().max(500, "Máximo 500 caracteres.").nullable().optional().transform((v) => (v && v.length > 0 ? v : null)),
  })
  .refine((data) => data.name.length > 0, { message: "Indica el nombre del producto." });

export type AddShoppingItemInput = z.infer<typeof addShoppingItemSchema>;

export const updateQuantitySchema = z.object({
  id: z.string().uuid(),
  quantity_needed: z.number().int().positive().optional(),
  quantity_purchased: z.number().int().min(0).optional(),
});

export type UpdateQuantityInput = z.infer<typeof updateQuantitySchema>;

export const toggleCheckedSchema = z.object({
  id: z.string().uuid(),
  is_checked: z.boolean(),
});

export type ToggleCheckedInput = z.infer<typeof toggleCheckedSchema>;

export const closeShoppingListSchema = z.object({
  id: z.string().uuid(),
});

export type CloseShoppingListInput = z.infer<typeof closeShoppingListSchema>;

// ── Helpers ───────────────────────────────────────────────

function parseZodError(error: { issues: { message: string }[] }): MutationResult {
  return { success: false, error: error.issues.map((i) => i.message).join(", ") };
}

function computeProgress(items: { isChecked: boolean }[]): { total: number; checked: number; percent: number } {
  const total = items.length;
  const checked = items.filter((i) => i.isChecked).length;
  const percent = total === 0 ? 0 : Math.round((checked / total) * 100);
  return { total, checked, percent };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapShoppingItemRow(row: any): ShoppingItem {
  return {
    id: row.id,
    shoppingListId: row.shopping_list_id,
    barItemId: row.bar_item_id ?? null,
    name: row.name,
    quantityNeeded: row.quantity_needed,
    quantityPurchased: row.quantity_purchased ?? 0,
    isChecked: Boolean(row.is_checked),
    notes: row.notes ?? null,
    createdAt: row.created_at,
  };
}

// ── Queries ───────────────────────────────────────────────

export async function getShoppingLists(): Promise<ShoppingListSummary[]> {
  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) throw new Error("No tienes permisos para ver listas de compra.");

  const supabase = await createClient();
  const { data: lists, error } = await supabase
    .from("bar_shopping_lists")
    .select("id, title, status, created_by, created_at, closed_at")
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Error al obtener listas: ${error.message}`);
  if (!lists || lists.length === 0) return [];

  const ids = lists.map((l) => (l as { id: string }).id);
  const { data: items, error: itemsError } = await supabase
    .from("bar_shopping_items")
    .select("id, shopping_list_id, is_checked")
    .in("shopping_list_id", ids);

  if (itemsError) throw new Error(`Error al obtener items: ${itemsError.message}`);

  const itemsByList = new Map<string, { is_checked: boolean }[]>();
  for (const item of (items ?? []) as { shopping_list_id: string; is_checked: boolean }[]) {
    const arr = itemsByList.get(item.shopping_list_id) ?? [];
    arr.push({ is_checked: item.is_checked });
    itemsByList.set(item.shopping_list_id, arr);
  }

  return (lists as { id: string; title: string; status: ShoppingStatus; created_by: string | null; created_at: string; closed_at: string | null }[]).map(
    (list) => {
      const listItems = itemsByList.get(list.id) ?? [];
      const progress = computeProgress(listItems.map((i) => ({ isChecked: i.is_checked })));
      return {
        id: list.id,
        title: list.title,
        status: list.status,
        createdBy: list.created_by,
        createdAt: list.created_at,
        closedAt: list.closed_at,
        total: progress.total,
        checked: progress.checked,
        percent: progress.percent,
      };
    },
  );
}

export async function getOpenShoppingLists(): Promise<ShoppingListSummary[]> {
  const all = await getShoppingLists();
  return all.filter((l) => l.status === "open");
}

export async function getShoppingListWithItems(listId: string): Promise<ShoppingList | null> {
  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) throw new Error("No tienes permisos para ver listas de compra.");

  const supabase = await createClient();
  const { data: list, error } = await supabase
    .from("bar_shopping_lists")
    .select("id, title, status, created_by, created_at, closed_at")
    .eq("id", listId)
    .maybeSingle();

  if (error) throw new Error(`Error al obtener lista: ${error.message}`);
  if (!list) return null;

  const typedList = list as { id: string; title: string; status: ShoppingStatus; created_by: string | null; created_at: string; closed_at: string | null };

  const { data: items, error: itemsError } = await supabase
    .from("bar_shopping_items")
    .select("id, shopping_list_id, bar_item_id, name, quantity_needed, quantity_purchased, is_checked, notes, created_at")
    .eq("shopping_list_id", listId)
    .order("created_at", { ascending: true });

  if (itemsError) throw new Error(`Error al obtener items: ${itemsError.message}`);

  const mappedItems: ShoppingItem[] = ((items ?? []) as unknown as Record<string, unknown>[]).map((r) =>
    mapShoppingItemRow(r),
  );

  // Enrich with bar_items stock if bar_item_id exists
  const barItemIds = [...new Set(mappedItems.map((i) => i.barItemId).filter(Boolean))] as string[];
  if (barItemIds.length > 0) {
    const { data: barItems } = await supabase.from("bar_items").select("id, stock_quantity, category, price").in("id", barItemIds);
    const barMap = new Map<string, { stock_quantity: number; category: BarCategory; price: number }>();
    for (const bi of (barItems ?? []) as { id: string; stock_quantity: number; category: BarCategory; price: number }[]) {
      barMap.set(bi.id, bi);
    }
    for (const item of mappedItems) {
      if (item.barItemId) {
        const bi = barMap.get(item.barItemId);
        if (bi) {
          item.stockQuantity = bi.stock_quantity;
          item.category = bi.category;
          item.price = bi.price;
        }
      }
    }
  }

  const progress = computeProgress(mappedItems.map((i) => ({ isChecked: i.isChecked })));

  return {
    id: typedList.id,
    title: typedList.title,
    status: typedList.status,
    createdBy: typedList.created_by,
    createdAt: typedList.created_at,
    closedAt: typedList.closed_at,
    items: mappedItems,
    progress,
  };
}

export async function getBarItemsForShoppingAutocomplete(q: string): Promise<ReturnType<typeof mapBarItemRow>[]> {
  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) throw new Error("No tienes permisos.");

  const supabase = await createClient();
  let query = supabase.from("bar_items").select("id, name, description, category, price, is_available, is_visible_to_members, stock_quantity, created_by, created_at, updated_at");
  if (q.trim().length > 0) {
    query = query.ilike("name", `%${q.trim()}%`);
  }
  query = query.order("name", { ascending: true }).limit(20);
  const { data, error } = await query;
  if (error) throw new Error(`Error al buscar productos: ${error.message}`);
  return (data ?? []).map((row) => mapBarItemRow(row as Record<string, unknown>));
}

// ── Mutations ─────────────────────────────────────────────

export async function createShoppingList(input: CreateShoppingListInput): Promise<MutationResult> {
  const parsed = createShoppingListSchema.safeParse(input);
  if (!parsed.success) return parseZodError(parsed.error);

  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) return { success: false, error: "Solo el responsable de barra o super_admin puede crear listas." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bar_shopping_lists")
    .insert({ title: parsed.data.title.trim(), status: "open", created_by: actor.id })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, id: (data as { id: string }).id };
}

export async function addItemToShoppingList(input: AddShoppingItemInput): Promise<MutationResult> {
  const parsed = addShoppingItemSchema.safeParse(input);
  if (!parsed.success) return parseZodError(parsed.error);

  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) return { success: false, error: "Solo el responsable de barra o super_admin puede añadir items." };

  const supabase = await createClient();

  // Verify list exists and is open
  const { data: list, error: listError } = await supabase
    .from("bar_shopping_lists")
    .select("id, status")
    .eq("id", parsed.data.shopping_list_id)
    .maybeSingle();

  if (listError) return { success: false, error: listError.message };
  if (!list) return { success: false, error: "Lista no encontrada." };
  if ((list as { status: string }).status === "closed") return { success: false, error: "La lista está cerrada." };

  const { data, error } = await supabase
    .from("bar_shopping_items")
    .insert({
      shopping_list_id: parsed.data.shopping_list_id,
      bar_item_id: parsed.data.bar_item_id ?? null,
      name: parsed.data.name.trim(),
      quantity_needed: parsed.data.quantity_needed,
      quantity_purchased: 0,
      is_checked: false,
      notes: parsed.data.notes ?? null,
    })
    .select("id")
    .single();

  if (error) return { success: false, error: error.message };
  return { success: true, id: (data as { id: string }).id };
}

export async function updateShoppingItemQuantity(input: UpdateQuantityInput): Promise<MutationResult> {
  const parsed = updateQuantitySchema.safeParse(input);
  if (!parsed.success) return parseZodError(parsed.error);

  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) return { success: false, error: "Solo el responsable de barra o super_admin puede editar cantidades." };

  const payload: Record<string, unknown> = {};
  if (parsed.data.quantity_needed !== undefined) payload.quantity_needed = parsed.data.quantity_needed;
  if (parsed.data.quantity_purchased !== undefined) payload.quantity_purchased = parsed.data.quantity_purchased;

  const supabase = await createClient();
  const { data, error } = await (supabase.from("bar_shopping_items") as unknown as { update: (p: Record<string, unknown>) => { eq: (a:string,b:string)=>{ select:(s:string)=>{ maybeSingle:()=>Promise<{data:{id:string}|null,error:{message:string}|null}> } } } }).update(payload).eq("id", parsed.data.id).select("id").maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Item no encontrado." };
  return { success: true, id: (data as { id: string }).id };
}

export async function toggleShoppingItemChecked(input: ToggleCheckedInput): Promise<MutationResult> {
  const parsed = toggleCheckedSchema.safeParse(input);
  if (!parsed.success) return parseZodError(parsed.error);

  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) return { success: false, error: "Solo el responsable de barra o super_admin puede marcar items." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bar_shopping_items")
    .update({ is_checked: parsed.data.is_checked })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Item no encontrado." };
  return { success: true, id: (data as { id: string }).id };
}

export async function closeShoppingList(input: CloseShoppingListInput): Promise<MutationResult> {
  const parsed = closeShoppingListSchema.safeParse(input);
  if (!parsed.success) return parseZodError(parsed.error);

  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) return { success: false, error: "Solo el responsable de barra o super_admin puede cerrar listas." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bar_shopping_lists")
    .update({ status: "closed", closed_at: new Date().toISOString() })
    .eq("id", parsed.data.id)
    .eq("status", "open")
    .select("id")
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Lista no encontrada o ya cerrada." };
  return { success: true, id: (data as { id: string }).id };
}

export async function deleteShoppingItem(input: { id: string }): Promise<MutationResult> {
  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) return { success: false, error: "Solo el responsable de barra o super_admin puede eliminar items." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("bar_shopping_items").delete().eq("id", input.id).select("id").maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Item no encontrado." };
  return { success: true };
}

export async function deleteShoppingList(input: { id: string }): Promise<MutationResult> {
  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) return { success: false, error: "Solo el responsable de barra o super_admin puede eliminar listas." };

  const supabase = await createClient();
  const { data, error } = await supabase.from("bar_shopping_lists").delete().eq("id", input.id).select("id").maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Lista no encontrada." };
  return { success: true };
}
