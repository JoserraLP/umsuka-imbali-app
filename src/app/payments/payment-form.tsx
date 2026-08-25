"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { registerPaymentAction } from "@/lib/payments/actions";
import { PAYMENT_TYPES, PAYMENT_TYPE_LABELS, MONTH_NAMES } from "@/lib/payments/schema";

interface PaymentFormProps {
  members: { id: string; firstName: string; lastName: string }[];
}

export function PaymentForm({ members }: PaymentFormProps) {
  const router = useRouter();
  const [userId, setUserId] = useState(members[0]?.id ?? "");
  const [paymentType, setPaymentType] = useState<"monthly" | "yearly">("monthly");
  const [periodMonth, setPeriodMonth] = useState<number>(new Date().getMonth() + 1);
  const [periodYear, setPeriodYear] = useState<number>(new Date().getFullYear());
  const [amount, setAmount] = useState("");
  const [paidAt, setPaidAt] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    const result = await registerPaymentAction({
      user_id: userId,
      payment_type: paymentType,
      period_month: paymentType === "monthly" ? periodMonth : null,
      period_year: periodYear,
      amount: amount as unknown as number,
      paid_at: paidAt,
      notes: notes.trim(),
    });

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "No se pudo registrar el pago.");
      return;
    }

    setSuccess("Pago registrado correctamente.");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pay-user">Miembro</Label>
        <select
          id="pay-user"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          required
        >
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.firstName} {m.lastName}
            </option>
          ))}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pay-type">Tipo</Label>
          <select
            id="pay-type"
            value={paymentType}
            onChange={(e) => setPaymentType(e.target.value as "monthly" | "yearly")}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {PAYMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {PAYMENT_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pay-year">Año</Label>
          <Input
            id="pay-year"
            type="number"
            min={1}
            max={9999}
            value={periodYear}
            onChange={(e) => setPeriodYear(Number(e.target.value))}
            required
          />
        </div>
      </div>

      {paymentType === "monthly" && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pay-month">Mes</Label>
          <select
            id="pay-month"
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
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pay-amount">Importe (€)</Label>
          <Input
            id="pay-amount"
            type="number"
            step="0.01"
            min="0.01"
            max="99999999.99"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Ej: 25.00"
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="pay-date">Fecha de pago</Label>
          <Input id="pay-date" type="date" value={paidAt} onChange={(e) => setPaidAt(e.target.value)} required />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pay-notes">Notas (opcional)</Label>
        <textarea
          id="pay-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Notas..."
          maxLength={2000}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      {success && <p className="text-sm text-green-600">{success}</p>}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando..." : "Registrar pago"}
        </Button>
      </div>
    </form>
  );
}
