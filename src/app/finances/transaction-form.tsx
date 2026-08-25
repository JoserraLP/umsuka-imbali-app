"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createTransactionAction,
  updateTransactionAction,
} from "@/lib/finances/actions";
import {
  TRANSACTION_CATEGORIES,
  TRANSACTION_CATEGORY_LABELS,
  TRANSACTION_TYPES,
  TRANSACTION_TYPE_LABELS,
} from "@/lib/finances/schema";

interface TransactionFormProps {
  mode: "create" | "edit";
  transactionId?: string;
  defaultValues?: {
    type: string;
    category: string;
    amount: string;
    description: string;
    transaction_date: string;
  };
  onSuccess?: () => void;
  onCancel?: () => void;
}

export function TransactionForm({
  mode,
  transactionId,
  defaultValues,
  onSuccess,
  onCancel,
}: TransactionFormProps) {
  const router = useRouter();
  const [type, setType] = useState(defaultValues?.type ?? "income");
  const [category, setCategory] = useState(defaultValues?.category ?? "bar_shift");
  const [amount, setAmount] = useState(defaultValues?.amount ?? "");
  const [description, setDescription] = useState(defaultValues?.description ?? "");
  const [transactionDate, setTransactionDate] = useState(
    defaultValues?.transaction_date ?? new Date().toISOString().slice(0, 10),
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setIsSubmitting(true);
    setError(null);

    const input = {
      type: type as (typeof TRANSACTION_TYPES)[number],
      category: category as (typeof TRANSACTION_CATEGORIES)[number],
      amount: amount as unknown as number,
      description: description.trim(),
      transaction_date: transactionDate,
    };

    const result =
      mode === "create"
        ? await createTransactionAction(input)
        : await updateTransactionAction({ id: transactionId!, ...input });

    setIsSubmitting(false);

    if (!result.success) {
      setError(result.error ?? "No se pudo guardar la transacción.");
      return;
    }

    if (onSuccess) onSuccess();
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tx-type">Tipo</Label>
          <select
            id="tx-type"
            value={type}
            onChange={(e) => setType(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {TRANSACTION_TYPES.map((t) => (
              <option key={t} value={t}>
                {TRANSACTION_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tx-category">Categoría</Label>
          <select
            id="tx-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {TRANSACTION_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {TRANSACTION_CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tx-amount">Importe (€)</Label>
          <Input
            id="tx-amount"
            type="number"
            step="0.01"
            min="0.01"
            max="99999999.99"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Ej: 150.50"
            required
          />
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="tx-date">Fecha</Label>
          <Input
            id="tx-date"
            type="date"
            value={transactionDate}
            onChange={(e) => setTransactionDate(e.target.value)}
            required
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tx-description">Descripción (opcional)</Label>
        <textarea
          id="tx-description"
          rows={3}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Concepto, notas..."
          maxLength={2000}
          className="flex w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        />
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Guardando…" : mode === "create" ? "Registrar" : "Guardar cambios"}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel} disabled={isSubmitting}>
            Cancelar
          </Button>
        )}
      </div>
    </form>
  );
}
