import { Badge } from "@/components/ui/badge";
import type { FinanceSummary } from "@/lib/finances/queries";
import { TRANSACTION_CATEGORY_LABELS } from "@/lib/finances/schema";
import { ArrowDownRight, ArrowUpRight, Wallet } from "lucide-react";

function formatEUR(value: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value);
}

export function FinanceSummaryCards({ summary }: { summary: FinanceSummary }) {
  const balancePositive = summary.balance >= 0;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <ArrowUpRight className="h-3.5 w-3.5 text-emerald-600" />
            Ingresos
          </div>
          <p className="mt-1 text-xl font-bold tabular-nums text-emerald-700 dark:text-emerald-400">
            {formatEUR(summary.totalIncome)}
          </p>
          <p className="text-xs text-muted-foreground">{summary.count === 0 ? "Sin movimientos" : `${summary.count} transacciones`}</p>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <ArrowDownRight className="h-3.5 w-3.5 text-red-600" />
            Gastos
          </div>
          <p className="mt-1 text-xl font-bold tabular-nums text-red-700 dark:text-red-400">
            {formatEUR(summary.totalExpense)}
          </p>
          <p className="text-xs text-muted-foreground">Total gastado</p>
        </div>

        <div className="rounded-xl border bg-card p-4">
          <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
            <Wallet className="h-3.5 w-3.5" />
            Saldo
          </div>
          <p
            className={`mt-1 text-xl font-bold tabular-nums ${balancePositive ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
          >
            {formatEUR(summary.balance)}
          </p>
          <p className="text-xs text-muted-foreground">{balancePositive ? "Positivo" : "Negativo"}</p>
        </div>
      </div>

      <div className="rounded-xl border bg-card p-4">
        <h3 className="text-sm font-semibold">Desglose por categoría</h3>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {(Object.entries(summary.byCategory) as [keyof typeof summary.byCategory, (typeof summary.byCategory)[keyof typeof summary.byCategory]][]).map(
            ([category, values]) => (
              <div key={category} className="rounded-lg border bg-muted/30 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-medium">{TRANSACTION_CATEGORY_LABELS[category]}</span>
                  <Badge variant="secondary" className="text-[10px]">
                    {values.count}
                  </Badge>
                </div>
                <div className="mt-2 flex gap-3 text-xs tabular-nums">
                  <span className="text-emerald-700 dark:text-emerald-400">+{formatEUR(values.income)}</span>
                  <span className="text-red-700 dark:text-red-400">-{formatEUR(values.expense)}</span>
                </div>
              </div>
            ),
          )}
        </div>
      </div>
    </div>
  );
}
