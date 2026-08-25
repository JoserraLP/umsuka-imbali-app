import { createClient } from "@/lib/supabase/server";
import type { TransactionCategory, TransactionType } from "@/lib/finances/schema";

// ── Types ─────────────────────────────────────────
export interface TransactionRow {
  id: string;
  type: TransactionType;
  category: TransactionCategory;
  amount: number;
  description: string | null;
  transactionDate: string;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface TransactionFilters {
  type?: TransactionType;
  category?: TransactionCategory;
  from?: string;
  to?: string;
}

export interface FinanceSummary {
  totalIncome: number;
  totalExpense: number;
  balance: number;
  count: number;
  byCategory: Record<TransactionCategory, { income: number; expense: number; count: number }>;
}

export interface MonthlyStat {
  month: string; // YYYY-MM
  income: number;
  expense: number;
  balance: number;
  count: number;
}

// ── Helpers ───────────────────────────────────────
function normalizeAmount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseFloat(value);
  return 0;
}

function emptyByCategory(): FinanceSummary["byCategory"] {
  return {
    bar_shift: { income: 0, expense: 0, count: 0 },
    bar_purchases: { income: 0, expense: 0, count: 0 },
    costume_materials: { income: 0, expense: 0, count: 0 },
    dance_materials: { income: 0, expense: 0, count: 0 },
    other: { income: 0, expense: 0, count: 0 },
  };
}

// ── Queries ───────────────────────────────────────

/**
 * Returns transactions ordered by transaction_date desc, then created_at desc.
 * Filters are applied as exact matches for type/category and inclusive range for dates.
 */
export async function getTransactions(filters: TransactionFilters = {}): Promise<TransactionRow[]> {
  const supabase = await createClient();

  let query = supabase
    .from("transactions")
    .select("id, type, category, amount, description, transaction_date, created_by, created_at, updated_at");

  if (filters.type) {
    query = query.eq("type", filters.type);
  }
  if (filters.category) {
    query = query.eq("category", filters.category);
  }
  if (filters.from) {
    query = query.gte("transaction_date", filters.from);
  }
  if (filters.to) {
    query = query.lte("transaction_date", filters.to);
  }

  const { data, error } = await query
    .order("transaction_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Error al obtener transacciones: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    type: row.type as TransactionType,
    category: row.category as TransactionCategory,
    amount: normalizeAmount(row.amount),
    description: row.description ?? null,
    transactionDate: row.transaction_date,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export async function getTransactionById(id: string): Promise<TransactionRow | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("transactions")
    .select("id, type, category, amount, description, transaction_date, created_by, created_at, updated_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al obtener la transacción: ${error.message}`);
  }

  if (!data) return null;

  return {
    id: data.id,
    type: data.type as TransactionType,
    category: data.category as TransactionCategory,
    amount: normalizeAmount(data.amount),
    description: data.description ?? null,
    transactionDate: data.transaction_date,
    createdBy: data.created_by ?? null,
    createdAt: data.created_at,
    updatedAt: data.updated_at,
  };
}

/**
 * Aggregates totals, balance and per-category breakdown from the filtered set.
 * Aggregation is done in JS (pattern of lib/stats) — acceptable for <10k rows.
 */
export async function getSummary(filters: TransactionFilters = {}): Promise<FinanceSummary> {
  const rows = await getTransactions(filters);

  const summary: FinanceSummary = {
    totalIncome: 0,
    totalExpense: 0,
    balance: 0,
    count: rows.length,
    byCategory: emptyByCategory(),
  };

  for (const row of rows) {
    if (row.type === "income") {
      summary.totalIncome += row.amount;
      summary.byCategory[row.category].income += row.amount;
    } else {
      summary.totalExpense += row.amount;
      summary.byCategory[row.category].expense += row.amount;
    }
    summary.byCategory[row.category].count += 1;
  }

  summary.totalIncome = Math.round(summary.totalIncome * 100) / 100;
  summary.totalExpense = Math.round(summary.totalExpense * 100) / 100;
  summary.balance = Math.round((summary.totalIncome - summary.totalExpense) * 100) / 100;

  for (const key of Object.keys(summary.byCategory) as TransactionCategory[]) {
    summary.byCategory[key].income = Math.round(summary.byCategory[key].income * 100) / 100;
    summary.byCategory[key].expense = Math.round(summary.byCategory[key].expense * 100) / 100;
  }

  return summary;
}

/**
 * Monthly aggregation for the given year (default current year). Returns 12 buckets
 * (YYYY-MM) even when empty, ordered chronologically Jan→Dec. Optional filters
 * (type/category/from/to) are intersected with the year window.
 */
export async function getMonthlyStats(options: { year?: number; filters?: TransactionFilters } = {}): Promise<MonthlyStat[]> {
  const year = options.year ?? new Date().getFullYear();
  const filters = options.filters ?? {};

  const yearFrom = `${year}-01-01`;
  const yearTo = `${year}-12-31`;

  // Intersect year window with caller filters
  const effectiveFrom = filters.from && filters.from > yearFrom ? filters.from : yearFrom;
  const effectiveTo = filters.to && filters.to < yearTo ? filters.to : yearTo;

  if (effectiveFrom > effectiveTo) {
    // No overlap with the requested year — return empty year
    return buildEmptyYear(year);
  }

  const rows = await getTransactions({
    ...filters,
    from: effectiveFrom,
    to: effectiveTo,
  });

  const byMonth = new Map<string, MonthlyStat>();

  for (let m = 1; m <= 12; m += 1) {
    const monthKey = `${year}-${String(m).padStart(2, "0")}`;
    byMonth.set(monthKey, { month: monthKey, income: 0, expense: 0, balance: 0, count: 0 });
  }

  for (const row of rows) {
    const monthKey = row.transactionDate.slice(0, 7);
    const bucket = byMonth.get(monthKey);
    if (!bucket) continue;
    if (row.type === "income") bucket.income += row.amount;
    else bucket.expense += row.amount;
    bucket.count += 1;
  }

  for (const bucket of byMonth.values()) {
    bucket.income = Math.round(bucket.income * 100) / 100;
    bucket.expense = Math.round(bucket.expense * 100) / 100;
    bucket.balance = Math.round((bucket.income - bucket.expense) * 100) / 100;
  }

  return [...byMonth.values()];
}

function buildEmptyYear(year: number): MonthlyStat[] {
  const result: MonthlyStat[] = [];
  for (let m = 1; m <= 12; m += 1) {
    result.push({
      month: `${year}-${String(m).padStart(2, "0")}`,
      income: 0,
      expense: 0,
      balance: 0,
      count: 0,
    });
  }
  return result;
}
