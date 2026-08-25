"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TransactionRow } from "@/lib/finances/queries";
import { TRANSACTION_CATEGORY_LABELS, TRANSACTION_TYPE_LABELS } from "@/lib/finances/schema";
import { deleteTransactionAction } from "@/lib/finances/actions";
import { TransactionForm } from "@/app/finances/transaction-form";
import { Pencil, Trash2, Wallet } from "lucide-react";
import { useRouter } from "next/navigation";

function formatEUR(value: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value);
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("es-ES", { dateStyle: "long" }).format(new Date(value));
}

function TransactionItem({ item }: { item: TransactionRow }) {
  const router = useRouter();
  const [isEditing, setIsEditing] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    if (!globalThis.confirm("¿Eliminar esta transacción? Esta acción no se puede deshacer.")) return;
    setIsDeleting(true);
    setError(null);
    const result = await deleteTransactionAction({ id: item.id });
    setIsDeleting(false);
    if (!result.success) {
      setError(result.error ?? "No se pudo eliminar.");
      return;
    }
    router.refresh();
  }

  if (isEditing) {
    return (
      <div className="rounded-xl border bg-card p-4">
        <h4 className="mb-3 text-sm font-semibold">Editar transacción</h4>
        <TransactionForm
          mode="edit"
          transactionId={item.id}
          defaultValues={{
            type: item.type,
            category: item.category,
            amount: String(item.amount),
            description: item.description ?? "",
            transaction_date: item.transactionDate,
          }}
          onSuccess={() => setIsEditing(false)}
          onCancel={() => setIsEditing(false)}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border bg-card p-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant={item.type === "income" ? "default" : "secondary"} className="text-[11px]">
            {TRANSACTION_TYPE_LABELS[item.type]}
          </Badge>
          <Badge variant="outline" className="text-[11px]">
            {TRANSACTION_CATEGORY_LABELS[item.category]}
          </Badge>
          <span className="text-xs text-muted-foreground">{formatDate(item.transactionDate)}</span>
        </div>
        <p
          className={`mt-2 text-base font-semibold tabular-nums ${item.type === "income" ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
        >
          {item.type === "income" ? "+" : "-"}
          {formatEUR(item.amount)}
        </p>
        {item.description && <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{item.description}</p>}
        {error && (
          <p role="alert" className="mt-2 text-sm text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="flex shrink-0 gap-2">
        <Button type="button" size="sm" variant="outline" onClick={() => setIsEditing(true)}>
          <Pencil className="mr-1 h-3.5 w-3.5" />
          Editar
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={handleDelete} disabled={isDeleting}>
          <Trash2 className="mr-1 h-3.5 w-3.5" />
          {isDeleting ? "…" : "Eliminar"}
        </Button>
      </div>
    </div>
  );
}

export function TransactionList({ items }: { items: TransactionRow[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed bg-card py-16 text-center">
        <Wallet className="mb-2 h-10 w-10 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No hay transacciones con los filtros actuales.</p>
        <p className="mt-1 text-xs text-muted-foreground/60">Registra el primer ingreso o gasto de la comparsa.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item) => (
        <TransactionItem key={item.id} item={item} />
      ))}
    </div>
  );
}
