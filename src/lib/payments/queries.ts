import { createClient } from "@/lib/supabase/server";
import type { PaymentType } from "@/lib/payments/schema";

// ── Types ─────────────────────────────────────────
export interface PaymentRow {
  id: string;
  userId: string;
  paymentType: PaymentType;
  periodMonth: number | null;
  periodYear: number;
  amount: number;
  paidAt: string;
  registeredBy: string | null;
  notes: string | null;
  createdAt: string;
}

export interface EligibilityResult {
  eligible: { userId: string; displayName?: string }[];
  pending: { userId: string; displayName?: string }[];
}

function normalizeAmount(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number.parseFloat(value);
  return 0;
}

function mapRow(row: {
  id: string;
  user_id: string | null;
  payment_type: PaymentType;
  period_month: number | null;
  period_year: number;
  amount: unknown;
  paid_at: string;
  registered_by: string | null;
  notes: string | null;
  created_at: string;
}): PaymentRow | null {
  if (!row.user_id) return null;
  return {
    id: row.id,
    userId: row.user_id,
    paymentType: row.payment_type as PaymentType,
    periodMonth: row.period_month,
    periodYear: row.period_year,
    amount: normalizeAmount(row.amount),
    paidAt: row.paid_at,
    registeredBy: row.registered_by ?? null,
    notes: row.notes ?? null,
    createdAt: row.created_at,
  };
}

// ── Carnival year helper (marzo→febrero) ─────────────────
/**
 * Año carnavalero marzo→febrero: marzo del año N a febrero de N+1 pertenece a N.
 * Ej: 2027-01-15 (enero 2027) → 2026; 2026-03-10 → 2026.
 */
export function getCarnivalYear(year: number, month: number): number {
  return month >= 3 ? year : year - 1;
}

// ── Pure eligibility helper (testeable sin DB) ────
/**
 * Returns true if the given payment list covers the month/year of the event.
 * Yearly: cubre si period_year === año carnavalero del evento (marzo→febrero).
 * Monthly: debe coincidir mes+año exactos (calendario).
 * Accepts both snake_case (DB) and camelCase (PaymentRow) shapes.
 */
export function isPaidForMonth(
  payments: (
    | { payment_type: PaymentType; period_month: number | null; period_year: number }
    | { paymentType: PaymentType; periodMonth: number | null; periodYear: number }
  )[],
  eventYear: number,
  eventMonth: number,
): boolean {
  const carnivalYear = getCarnivalYear(eventYear, eventMonth);
  for (const p of payments) {
    const type = (p as { payment_type?: PaymentType; paymentType?: PaymentType }).payment_type ?? (p as { paymentType?: PaymentType }).paymentType;
    const year = (p as { period_year?: number; periodYear?: number }).period_year ?? (p as { periodYear?: number }).periodYear;
    const month = (p as { period_month?: number | null; periodMonth?: number | null }).period_month ?? (p as { periodMonth?: number | null }).periodMonth ?? null;
    if (type === "yearly" && year === carnivalYear) return true;
    if (type === "monthly" && year === eventYear && month === eventMonth) return true;
  }
  return false;
}

// ── Queries ───────────────────────────────────────

export async function getPaymentsByUser(userId: string): Promise<PaymentRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_payments")
    .select("id, user_id, payment_type, period_month, period_year, amount, paid_at, registered_by, notes, created_at")
    .eq("user_id", userId)
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Error al obtener pagos: ${error.message}`);
  return (data ?? []).map((r) => mapRow(r as never)).filter((r): r is PaymentRow => r !== null);
}

export async function getAllPayments(filters?: {
  period_year?: number;
  period_month?: number;
  payment_type?: PaymentType;
}): Promise<PaymentRow[]> {
  const supabase = await createClient();
  let query = supabase
    .from("member_payments")
    .select("id, user_id, payment_type, period_month, period_year, amount, paid_at, registered_by, notes, created_at");

  if (filters?.period_year) query = query.eq("period_year", filters.period_year);
  if (filters?.period_month) query = query.eq("period_month", filters.period_month);
  if (filters?.payment_type) query = query.eq("payment_type", filters.payment_type);

  const { data, error } = await query
    .order("period_year", { ascending: false })
    .order("period_month", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Error al obtener pagos: ${error.message}`);
  return (data ?? []).map((r) => mapRow(r as never)).filter((r): r is PaymentRow => r !== null);
}

/**
 * Payments grouped by user for eligibility. Used by getPaidMembersForEvent.
 */
export async function getPaymentsGroupedByUser(): Promise<Map<string, PaymentRow[]>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_payments")
    .select("id, user_id, payment_type, period_month, period_year, amount, paid_at, registered_by, notes, created_at");

  if (error) throw new Error(`Error al obtener pagos: ${error.message}`);

  const map = new Map<string, PaymentRow[]>();
  for (const row of data ?? []) {
    const pr = mapRow(row as never);
    if (!pr) continue;
    const list = map.get(pr.userId) ?? [];
    list.push(pr);
    map.set(pr.userId, list);
  }
  return map;
}

/**
 * Returns userIds that have a payment covering the month/year of the given eventDate (ISO string or YYYY-MM-DD).
 */
export async function getPaidMembersForEvent(eventDate: string): Promise<string[]> {
  const d = new Date(eventDate);
  if (Number.isNaN(d.getTime())) throw new Error("eventDate no es una fecha válida.");
  const eventYear = d.getUTCFullYear();
  const eventMonth = d.getUTCMonth() + 1;

  const grouped = await getPaymentsGroupedByUser();
  const eligible: string[] = [];
  for (const [userId, payments] of grouped) {
    if (isPaidForMonth(payments, eventYear, eventMonth)) eligible.push(userId);
  }
  return eligible;
}

/**
 * Eligibility for a given eventId: fetches event_date, then computes eligible/pending
 * from all active profiles (is_active, status active, deleted_at null).
 */
export async function getEligibilityForEvent(eventId: string): Promise<EligibilityResult> {
  const supabase = await createClient();

  const { data: event, error: eventError } = await supabase
    .from("events")
    .select("id, event_date")
    .eq("id", eventId)
    .maybeSingle();

  if (eventError) throw new Error(`Error al obtener evento: ${eventError.message}`);
  if (!event) throw new Error("Evento no encontrado.");

  const d = new Date(event.event_date);
  const eventYear = d.getUTCFullYear();
  const eventMonth = d.getUTCMonth() + 1;

  // All active members
  const { data: profiles, error: profilesError } = await supabase
    .from("profiles")
    .select("id, first_name, last_name")
    .eq("is_active", true)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("first_name", { ascending: true });

  if (profilesError) throw new Error(`Error al obtener miembros: ${profilesError.message}`);

  const grouped = await getPaymentsGroupedByUser();

  const eligible: EligibilityResult["eligible"] = [];
  const pending: EligibilityResult["pending"] = [];

  for (const p of profiles ?? []) {
    const payments = grouped.get(p.id) ?? [];
    const paid = isPaidForMonth(payments, eventYear, eventMonth);
    const entry = { userId: p.id, displayName: `${p.first_name} ${p.last_name}`.trim() };
    if (paid) eligible.push(entry);
    else pending.push(entry);
  }

  return { eligible, pending };
}

export async function getPaymentById(id: string): Promise<PaymentRow | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("member_payments")
    .select("id, user_id, payment_type, period_month, period_year, amount, paid_at, registered_by, notes, created_at")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`Error al obtener pago: ${error.message}`);
  if (!data) return null;
  return mapRow(data as never);
}
