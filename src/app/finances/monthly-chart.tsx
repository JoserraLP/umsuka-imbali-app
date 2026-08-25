"use client";

import type { MonthlyStat } from "@/lib/finances/queries";

const MONTH_LABELS = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

function formatEUR(value: number): string {
  return new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value);
}

export function MonthlyChart({ stats }: { stats: MonthlyStat[] }) {
  const maxValue = Math.max(...stats.map((s) => Math.max(s.income, s.expense)), 1);

  const currentMonth = new Date().toISOString().slice(0, 7);

  return (
    <div className="rounded-xl border bg-card p-4 sm:p-5">
      <h3 className="text-sm font-semibold">Ingresos vs gastos por mes</h3>
      <p className="mt-1 text-xs text-muted-foreground">Año en curso — barras proporcionales al máximo mensual.</p>

      <div className="mt-4 space-y-2">
        {stats.map((stat, index) => {
          const incomeWidth = (stat.income / maxValue) * 100;
          const expenseWidth = (stat.expense / maxValue) * 100;
          const isCurrent = stat.month === currentMonth;

          return (
            <div key={stat.month} className={`rounded-md px-2 py-1.5 ${isCurrent ? "bg-muted/60 ring-1 ring-border" : ""}`}>
              <div className="flex items-center justify-between text-xs">
                <span className={`w-10 font-medium ${isCurrent ? "text-primary" : "text-muted-foreground"}`}>
                  {MONTH_LABELS[index]}
                </span>
                <span className="tabular-nums text-muted-foreground">
                  {formatEUR(stat.income)} / {formatEUR(stat.expense)}
                  {stat.count > 0 && <span className="ml-2 text-[10px]">({stat.count})</span>}
                </span>
              </div>

              <div className="mt-1 flex flex-col gap-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${incomeWidth}%` }}
                    aria-label={`Ingresos ${MONTH_LABELS[index]} ${formatEUR(stat.income)}`}
                  />
                </div>
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-red-500 transition-all"
                    style={{ width: `${expenseWidth}%` }}
                    aria-label={`Gastos ${MONTH_LABELS[index]} ${formatEUR(stat.expense)}`}
                  />
                </div>
              </div>

              <div className="mt-1 flex justify-end">
                <span
                  className={`text-[11px] font-medium tabular-nums ${stat.balance >= 0 ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400"}`}
                >
                  Saldo {formatEUR(stat.balance)}
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex gap-4 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" /> Ingresos
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-red-500" /> Gastos
        </span>
      </div>
    </div>
  );
}
