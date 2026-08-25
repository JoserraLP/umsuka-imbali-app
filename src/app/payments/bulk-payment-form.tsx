"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { bulkRegisterMonthlyAction } from "@/lib/payments/actions";
import { MONTH_NAMES } from "@/lib/payments/schema";

interface BulkPaymentFormProps {
  members: { id: string; firstName: string; lastName: string }[];
}

export function BulkPaymentForm({ members }: BulkPaymentFormProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<string[]>([]);
  const [periodMonth, setPeriodMonth] = useState<number>(new Date().getMonth() + 1);
  const [periodYear, setPeriodYear] = useState<number>(new Date().getFullYear());
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  function toggleAll() {
    if (selected.length === members.length) setSelected([]);
    else setSelected(members.map((m) => m.id));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setResult(null);

    const res = await bulkRegisterMonthlyAction({
      user_ids: selected,
      period_month: periodMonth,
      period_year: periodYear,
      amount: amount as unknown as number,
      paid_at: paidAt,
      notes: notes.trim(),
    });

    setIsSubmitting(false);

    if (!res.success && res.errors.length > 0 && res.created === 0 && res.skipped === 0) {
      setError(res.error ?? "Error en el registro masivo.");
      return;
    }

    setResult(`Creados: ${res.created}, omitidos (ya existían): ${res.skipped}${res.errors.length ? `, errores: ${res.errors.join("; ")}` : ""}`);
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <Label>Miembros ({selected.length}/{members.length})</Label>
          <Button type="button" variant="outline" size="sm" onClick={toggleAll}>
            {selected.length === members.length ? "Deseleccionar todos" : "Seleccionar todos"}
          </Button>
        </div>
        <div className="max-h-48 overflow-y-auto rounded-md border p-2">
          {members.map((m) => (
            <label key={m.id} className="flex items-center gap-2 py-1 text-sm">
              <input type="checkbox" checked={selected.includes(m.id)} onChange={() => toggle(m.id)} />
              {m.firstName} {m.lastName}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-month">Mes</Label>
          <select
            id="bulk-month"
            value={periodMonth}
            onChange={(e) => setPeriodMonth(Number(e.target.value))}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {Object.entries(MONTH_NAMES).map(([num, name]) => (
              <option key={num} value={num}>
                {name}
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-year">Año</Label>
          <Input id="bulk-year" type="number" min={1} max={9999} value={periodYear} onChange={(e) => setPeriodYear(Number(e.target.value))} required />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="bulk-amount">Importe (€)</Label>
          <Input id="bulk-amount" type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="25.00" required />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bulk-date">Fecha de pago</Label>
        <Input id="bulk-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="bulk-notes">Notas (opcional)</Label>
        <textarea
          id="bulk-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={2000}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {result && <p className="text-sm text-green-600">{result}</p>}

      <Button type="submit" disabled={isSubmitting || selected.length === 0}>
        {isSubmitting ? "Guardando..." : `Registrar ${selected.length} pagos`}
      </Button>
    </form>
  );
}
