import "server-only";
import { createClient } from "@/lib/supabase/server";
import { isPaidForMonth } from "@/lib/payments/queries";

export interface MemberSummary {
  userId: string;
  payment: {
    status: "al_dia" | "pendiente" | "sin_pagos";
    label: string; // e.g. "Al día hasta 03/2026" or "Pendiente febrero"
    lastPayment: { periodMonth: number | null; periodYear: number; paymentType: string } | null;
    detail: string | null; // full detail for own/directiva
  };
  dancePosition: {
    assigned: boolean;
    label: string; // "Fila 2 — Asiento 4" or "Sin asignar"
    rowNumber: number | null;
    seatNumber: number | null;
    formationId: string | null;
    formationName: string | null;
  };
  instrument: {
    assigned: boolean;
    label: string; // "Bombo" or "Sin asignar"
    instrumentId: string | null;
    instrumentName: string | null;
    category: string | null;
  };
}

/**
 * Agrega estado de pago, posición de baile e instrumento en una sola llamada.
 * Queries en paralelo, merge en JS (patrón instruments/formation).
 */
export async function getMemberSummary(userId: string): Promise<MemberSummary> {
  const supabase = await createClient();

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const currentMonth = now.getUTCMonth() + 1;

  const [paymentsRes, positionRes, instrumentRes, legacyInstrumentRes] = await Promise.all([
    supabase
      .from("member_payments")
      .select("payment_type, period_month, period_year")
      .eq("user_id", userId)
      .order("period_year", { ascending: false })
      .order("period_month", { ascending: false, nullsFirst: false }),
    supabase
      .from("dance_positions")
      .select("id, formation_id, row_number, seat_number, dance_formations!inner(name)")
      .eq("member_id", userId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("musician_instruments")
      .select("id, instrument_id, instruments!inner(name, category)")
      .eq("user_id", userId)
      .limit(1)
      .maybeSingle(),
    supabase
      .from("instrument_assignments")
      .select("id, instrument_id")
      .eq("user_id", userId)
      .is("unassigned_at", null)
      .limit(1)
      .maybeSingle(),
  ]);

  // --- Payment: altruista, usa isPaidForMonth para "al día" si cubre mes actual
  const payments = (paymentsRes.data ?? []) as Array<{
    payment_type: "monthly" | "yearly";
    period_month: number | null;
    period_year: number;
  }>;

  let paymentStatus: MemberSummary["payment"] = {
    status: "sin_pagos",
    label: "Sin pagos",
    lastPayment: null,
    detail: null,
  };

  if (payments.length > 0) {
    // Last payment = most recent by year/month
    const last = payments[0]!;
    const lastPayment = {
      periodMonth: last.period_month,
      periodYear: last.period_year,
      paymentType: last.payment_type,
    };

    const isUpToDate = isPaidForMonth(payments as never, currentYear, currentMonth);

    if (isUpToDate) {
      const label =
        last.payment_type === "yearly"
          ? `Al día hasta 12/${last.period_year}`
          : `Al día hasta ${String(last.period_month).padStart(2, "0")}/${last.period_year}`;
      paymentStatus = {
        status: "al_dia",
        label,
        lastPayment,
        detail: label,
      };
    } else {
      // Pendiente: muestra último mes pagado o "Pendiente desde..."
      const label =
        last.payment_type === "yearly"
          ? `Al día hasta 12/${last.period_year} · Pendiente ${String(currentMonth).padStart(2, "0")}/${currentYear}`
          : `Pagado hasta ${String(last.period_month).padStart(2, "0")}/${last.period_year} · Pendiente`;
      paymentStatus = {
        status: "pendiente",
        label: `Pendiente ${String(currentMonth).padStart(2, "0")}/${currentYear}`,
        lastPayment,
        detail: label,
      };
    }
  } else {
    paymentStatus = {
      status: "pendiente",
      label: "Pendiente",
      lastPayment: null,
      detail: null,
    };
  }

  // --- Dance position: first assigned seat (member_id unique per formation)
  let dancePosition: MemberSummary["dancePosition"] = {
    assigned: false,
    label: "Sin asignar",
    rowNumber: null,
    seatNumber: null,
    formationId: null,
    formationName: null,
  };

  if (positionRes.data) {
    const p = positionRes.data as {
      formation_id: string;
      row_number: number;
      seat_number: number;
      dance_formations: { name: string } | { name: string }[];
    };
    const formationName = Array.isArray(p.dance_formations) ? p.dance_formations[0]?.name ?? null : (p.dance_formations as { name: string })?.name ?? null;
    dancePosition = {
      assigned: true,
      label: `Fila ${p.row_number} — Asiento ${p.seat_number}`,
      rowNumber: p.row_number,
      seatNumber: p.seat_number,
      formationId: p.formation_id,
      formationName,
    };
  } else if (positionRes.error && !positionRes.error.message.includes("0 rows")) {
    // ignore not-found, throw on real errors
    throw new Error(`Error al obtener posición: ${positionRes.error.message}`);
  }

  // --- Instrument: first assigned instrument (global or per-formation)
  let instrument: MemberSummary["instrument"] = {
    assigned: false,
    label: "Sin asignar",
    instrumentId: null,
    instrumentName: null,
    category: null,
  };

  if (instrumentRes.data) {
    const inst = instrumentRes.data as {
      instrument_id: string;
      instruments: { name: string; category: string | null } | { name: string; category: string | null }[];
    };
    const instData = Array.isArray(inst.instruments) ? inst.instruments[0] : inst.instruments;
    instrument = {
      assigned: true,
      label: instData?.name ?? "Instrumento",
      instrumentId: inst.instrument_id,
      instrumentName: instData?.name ?? null,
      category: instData?.category ?? null,
    };
  } else if (legacyInstrumentRes.data) {
    // Fallback to legacy assignment: fetch instrument details separately
    const legacy = legacyInstrumentRes.data as { instrument_id: string };
    // Fire separate fetch (sync via then? we already fetched, do ad-hoc query via thenable not available here)
    // Instead treat as assigned with instrument_id, try to fetch name lazily (use instrument_id as label fallback)
    // For accuracy, do extra query synchronously outside the Promise.all block would be cleaner,
    // but here we at least show instrument_id fallback; the detailed name fetch will happen on next call if needed.
    // Simpler: instrument label = Instrumento (legacy)
    instrument = {
      assigned: true,
      label: "Instrumento asignado",
      instrumentId: legacy.instrument_id,
      instrumentName: null,
      category: null,
    };
    // Attempt to enrich with instrument name via additional fetch (best-effort synchronous not possible here,
    // so we overwrite later if we can fetch)
    try {
      const { data: instData } = await supabase.from("instruments").select("name, category").eq("id", legacy.instrument_id).maybeSingle();
      if (instData) {
        instrument.label = (instData as { name: string }).name ?? "Instrumento asignado";
        instrument.instrumentName = (instData as { name: string }).name ?? null;
        instrument.category = (instData as { category: string | null }).category ?? null;
      }
    } catch {
      // keep fallback
    }
  } else if (instrumentRes.error && !String(instrumentRes.error.message).includes("0 rows") && !String(instrumentRes.error.message).includes("No rows")) {
    throw new Error(`Error al obtener instrumento: ${instrumentRes.error.message}`);
  }

  return {
    userId,
    payment: paymentStatus,
    dancePosition,
    instrument,
  };
}

/**
 * Variants: get summaries for multiple users (e.g. for directiva overview).
 * Simple sequential wrapper to keep RLS simple; bulk not needed for MVP.
 */
export async function getMemberSummaries(userIds: string[]): Promise<Map<string, MemberSummary>> {
  const map = new Map<string, MemberSummary>();
  for (const id of userIds) {
    const s = await getMemberSummary(id);
    map.set(id, s);
  }
  return map;
}
