import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { canManageBar, isBarLead } from "@/lib/bar/authorization";
import type { BarCategory } from "@/types/database.types";

// ── Types ─────────────────────────────────────────────────

export type { BarCategory };
export const BAR_CATEGORIES = ["menu", "food", "drink"] as const;
export const BAR_CATEGORY_VALUES = BAR_CATEGORIES;

export interface BarItem {
  id: string;
  name: string;
  description: string | null;
  category: BarCategory;
  price: number;
  isAvailable: boolean;
  isVisibleToMembers: boolean;
  stockQuantity: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BarPriceHistoryEntry {
  id: string;
  barItemId: string;
  oldPrice: number | null;
  newPrice: number;
  changedBy: string | null;
  changedAt: string;
}

export interface BarFilters {
  category?: BarCategory;
  isAvailable?: boolean;
  q?: string;
  includeHidden?: boolean;
  minStock?: number;
  maxStock?: number;
}

export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
}

// ── Helpers puros ─────────────────────────────────────────

export function mapBarItemRow(row: Record<string, unknown>): BarItem {
  return {
    id: String(row.id),
    name: String(row.name),
    description: (row.description as string | null) ?? null,
    category: row.category as BarCategory,
    price: typeof row.price === "string" ? Number(row.price) : (row.price as number),
    isAvailable: Boolean(row.is_available),
    isVisibleToMembers: Boolean(row.is_visible_to_members),
    stockQuantity: Number(row.stock_quantity ?? 0),
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function validateBarPrice(price: number): boolean {
  return typeof price === "number" && Number.isFinite(price) && price > 0 && price <= 99999999.99;
}

export { isBarLead, canManageBar };

// ── Schemas Zod ───────────────────────────────────────────

export const createBarItemSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(200, "Máximo 200 caracteres."),
  description: z
    .string()
    .trim()
    .max(1000, "Máximo 1000 caracteres.")
    .nullable()
    .optional()
    .transform((v) => (v && v.length > 0 ? v : null)),
  category: z.enum(BAR_CATEGORY_VALUES, {
    errorMap: () => ({ message: "Categoría no válida." }),
  }),
  price: z
    .union([z.number(), z.string().transform((v) => Number(v))])
    .pipe(z.number().positive("El precio debe ser > 0.").max(99999999.99, "Precio demasiado alto."))
    .refine((n) => Number.isFinite(n) && Math.round(n * 100) === n * 100, {
      message: "Máximo 2 decimales.",
    }),
  is_available: z.boolean().optional().default(true),
  is_visible_to_members: z.boolean().optional().default(true),
  stock_quantity: z.number().int("Debe ser entero.").min(0, "No puede ser negativo.").optional().default(0),
});

export type CreateBarItemInput = z.infer<typeof createBarItemSchema>;

export const updateBarPriceSchema = z.object({
  id: z.string().uuid("ID no válido."),
  price: z
    .union([z.number(), z.string().transform((v) => Number(v))])
    .pipe(z.number().positive("El precio debe ser > 0.").max(99999999.99)),
});

export type UpdateBarPriceInput = z.infer<typeof updateBarPriceSchema>;

export const updateStockSchema = z.object({
  id: z.string().uuid("ID no válido."),
  stock_quantity: z.number().int().min(0, "No puede ser negativo."),
});

export type UpdateStockInput = z.infer<typeof updateStockSchema>;

export const updateVisibilitySchema = z.object({
  id: z.string().uuid("ID no válido."),
  is_visible_to_members: z.boolean(),
});

export type UpdateVisibilityInput = z.infer<typeof updateVisibilitySchema>;

export const toggleAvailabilitySchema = z.object({
  id: z.string().uuid("ID no válido."),
  is_available: z.boolean(),
});

export type ToggleAvailabilityInput = z.infer<typeof toggleAvailabilitySchema>;

export const barFiltersSchema = z.object({
  category: z.enum(BAR_CATEGORY_VALUES).optional(),
  q: z.string().trim().optional().transform((v) => (v && v.length > 0 ? v : undefined)),
  isAvailable: z.boolean().optional(),
  includeHidden: z.boolean().optional(),
});

// ── Queries ───────────────────────────────────────────────

function applyBarFilters(
  query: unknown,
  filters?: BarFilters,
): unknown {
  // helper for chaining — typed as unknown to avoid supabase type coupling in tests
  let q = query as {
    eq: (c: string, v: unknown) => typeof q;
    ilike: (c: string, v: string) => typeof q;
    gte: (c: string, v: number) => typeof q;
    lte: (c: string, v: number) => typeof q;
    order: (c: string, opts?: unknown) => typeof q;
  };
  if (!filters) return q;
  if (filters.category) q = q.eq("category", filters.category);
  if (typeof filters.isAvailable === "boolean") q = q.eq("is_available", filters.isAvailable);
  if (filters.q) q = q.ilike("name", `%${filters.q}%`);
  if (filters.minStock !== undefined) q = q.gte("stock_quantity", filters.minStock);
  if (filters.maxStock !== undefined) q = q.lte("stock_quantity", filters.maxStock);
  return q;
}

export async function getVisibleBarItems(filters?: BarFilters): Promise<BarItem[]> {
  const supabase = await createClient();
  let query = supabase
    .from("bar_items")
    .select("id, name, description, category, price, is_available, is_visible_to_members, stock_quantity, created_by, created_at, updated_at")
    .eq("is_visible_to_members", true)
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  query = applyBarFilters(query, filters) as typeof query;

  const { data, error } = await query;
  if (error) throw new Error(`Error al obtener productos de barra: ${error.message}`);
  return (data ?? []).map((row) => mapBarItemRow(row as Record<string, unknown>));
}

export async function getAllBarItems(filters?: BarFilters): Promise<BarItem[]> {
  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) {
    throw new Error("No tienes permisos para ver todos los productos.");
  }
  const supabase = await createClient();
  let query = supabase
    .from("bar_items")
    .select("id, name, description, category, price, is_available, is_visible_to_members, stock_quantity, created_by, created_at, updated_at")
    .order("category", { ascending: true })
    .order("name", { ascending: true });

  if (filters?.includeHidden === false) {
    query = query.eq("is_visible_to_members", true) as typeof query;
  }
  query = applyBarFilters(query, filters) as typeof query;

  const { data, error } = await query;
  if (error) throw new Error(`Error al obtener productos de barra: ${error.message}`);
  return (data ?? []).map((row) => mapBarItemRow(row as Record<string, unknown>));
}

export async function getBarItemById(id: string): Promise<BarItem | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bar_items")
    .select("id, name, description, category, price, is_available, is_visible_to_members, stock_quantity, created_by, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Error al obtener producto: ${error.message}`);
  if (!data) return null;
  return mapBarItemRow(data as Record<string, unknown>);
}

export async function getBarPriceHistory(barItemId: string): Promise<BarPriceHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bar_price_history")
    .select("id, bar_item_id, old_price, new_price, changed_by, changed_at")
    .eq("bar_item_id", barItemId)
    .order("changed_at", { ascending: false });
  if (error) throw new Error(`Error al obtener histórico: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: (row as { id: string }).id,
    barItemId: (row as { bar_item_id: string }).bar_item_id,
    oldPrice: (row as { old_price: number | null }).old_price !== null ? Number((row as { old_price: unknown }).old_price) : null,
    newPrice: Number((row as { new_price: unknown }).new_price),
    changedBy: (row as { changed_by: string | null }).changed_by,
    changedAt: (row as { changed_at: string }).changed_at,
  }));
}

export async function getAllPriceHistory(limit = 50): Promise<BarPriceHistoryEntry[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bar_price_history")
    .select("id, bar_item_id, old_price, new_price, changed_by, changed_at")
    .order("changed_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Error al obtener histórico: ${error.message}`);
  return (data ?? []).map((row) => ({
    id: (row as { id: string }).id,
    barItemId: (row as { bar_item_id: string }).bar_item_id,
    oldPrice: (row as { old_price: number | null }).old_price !== null ? Number((row as { old_price: unknown }).old_price) : null,
    newPrice: Number((row as { new_price: unknown }).new_price),
    changedBy: (row as { changed_by: string | null }).changed_by,
    changedAt: (row as { changed_at: string }).changed_at,
  }));
}

// ── Mutations helpers ─────────────────────────────────────

function parseZodError(error: { issues: { message: string }[] }): MutationResult {
  return { success: false, error: error.issues.map((i) => i.message).join(", ") };
}

// ── Mutations ─────────────────────────────────────────────

export async function createBarItem(input: CreateBarItemInput): Promise<MutationResult> {
  const parsed = createBarItemSchema.safeParse(input);
  if (!parsed.success) return parseZodError(parsed.error);

  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) {
    return { success: false, error: "Solo el responsable de barra o super_admin puede crear productos." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bar_items")
    .insert({
      name: parsed.data.name.trim(),
      description: parsed.data.description,
      category: parsed.data.category,
      price: parsed.data.price,
      is_available: parsed.data.is_available,
      is_visible_to_members: parsed.data.is_visible_to_members,
      stock_quantity: parsed.data.stock_quantity,
      created_by: actor.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") return { success: false, error: "Ya existe un producto con ese nombre en esa categoría." };
    return { success: false, error: error.message };
  }
  return { success: true, id: (data as { id: string }).id };
}

export async function updateBarItem(input: {
  id: string;
  name?: string;
  description?: string | null;
  category?: BarCategory;
  price?: number;
  stock_quantity?: number;
  is_available?: boolean;
  is_visible_to_members?: boolean;
}): Promise<MutationResult> {
  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) {
    return { success: false, error: "Solo el responsable de barra o super_admin puede editar productos." };
  }
  const supabase = await createClient();
  const payload: Record<string, unknown> = {};
  if (input.name !== undefined) payload.name = input.name.trim();
  if (input.description !== undefined) payload.description = input.description;
  if (input.category !== undefined) payload.category = input.category;
  if (input.price !== undefined) payload.price = input.price;
  if (input.stock_quantity !== undefined) payload.stock_quantity = input.stock_quantity;
  if (input.is_available !== undefined) payload.is_available = input.is_available;
  if (input.is_visible_to_members !== undefined) payload.is_visible_to_members = input.is_visible_to_members;

  const { data, error } = await (supabase.from("bar_items") as unknown as { update: (p: Record<string, unknown>) => { eq: (a:string,b:string)=>{ select:(s:string)=>{ maybeSingle:()=>Promise<{data:{id:string}|null,error:{message:string,code?:string}|null}> } } } }).update(payload).eq("id", input.id).select("id").maybeSingle();
  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Producto no encontrado." };
  return { success: true, id: (data as { id: string }).id };
}

export async function updateBarPrice(input: UpdateBarPriceInput): Promise<MutationResult> {
  const parsed = updateBarPriceSchema.safeParse(input);
  if (!parsed.success) return parseZodError(parsed.error);

  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) {
    return { success: false, error: "Solo el responsable de barra o super_admin puede modificar precios." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bar_items")
    .update({ price: parsed.data.price })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Producto no encontrado." };
  return { success: true, id: (data as { id: string }).id };
}

export async function updateStock(input: UpdateStockInput): Promise<MutationResult> {
  const parsed = updateStockSchema.safeParse(input);
  if (!parsed.success) return parseZodError(parsed.error);

  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) {
    return { success: false, error: "Solo el responsable de barra o super_admin puede actualizar stock." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bar_items")
    .update({ stock_quantity: parsed.data.stock_quantity })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Producto no encontrado." };
  return { success: true, id: (data as { id: string }).id };
}

export async function toggleAvailability(input: ToggleAvailabilityInput): Promise<MutationResult> {
  const parsed = toggleAvailabilitySchema.safeParse(input);
  if (!parsed.success) return parseZodError(parsed.error);

  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) {
    return { success: false, error: "Solo el responsable de barra o super_admin puede cambiar disponibilidad." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bar_items")
    .update({ is_available: parsed.data.is_available })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Producto no encontrado." };
  return { success: true, id: (data as { id: string }).id };
}

export async function toggleVisibility(input: UpdateVisibilityInput): Promise<MutationResult> {
  const parsed = updateVisibilitySchema.safeParse(input);
  if (!parsed.success) return parseZodError(parsed.error);

  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) {
    return { success: false, error: "Solo el responsable de barra o super_admin puede cambiar visibilidad." };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("bar_items")
    .update({ is_visible_to_members: parsed.data.is_visible_to_members })
    .eq("id", parsed.data.id)
    .select("id")
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Producto no encontrado." };
  return { success: true, id: (data as { id: string }).id };
}

export async function deleteBarItem(input: { id: string }): Promise<MutationResult> {
  const actor = await requireAuthenticatedProfile();
  if (!canManageBar(actor)) {
    return { success: false, error: "Solo el responsable de barra o super_admin puede eliminar productos." };
  }

  const supabase = await createClient();
  // Soft delete: mark unavailable and hidden instead of hard delete
  const { data, error } = await supabase
    .from("bar_items")
    .update({ is_available: false, is_visible_to_members: false })
    .eq("id", input.id)
    .select("id")
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "Producto no encontrado." };
  return { success: true, id: (data as { id: string }).id };
}
