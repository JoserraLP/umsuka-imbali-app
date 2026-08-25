import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getTransactions, getSummary, getMonthlyStats } from "@/lib/finances/queries";
import { filterSchema } from "@/lib/finances/schema";
import { FinanceSummaryCards } from "@/app/finances/finance-summary-cards";
import { MonthlyChart } from "@/app/finances/monthly-chart";
import { TransactionFilters } from "@/app/finances/transaction-filters";
import { TransactionList } from "@/app/finances/transaction-list";
import { TransactionForm } from "@/app/finances/transaction-form";
import { Wallet } from "lucide-react";

export const metadata: Metadata = {
  title: "Finanzas",
};

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function FinancesPage({ searchParams }: PageProps) {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  if (!isManagementRole(profile.role)) {
    redirect("/dashboard");
  }

  const rawParams = await searchParams;

  const parsedFilters = filterSchema.safeParse({
    type: typeof rawParams.type === "string" ? rawParams.type : undefined,
    category: typeof rawParams.category === "string" ? rawParams.category : undefined,
    from: typeof rawParams.from === "string" ? rawParams.from : undefined,
    to: typeof rawParams.to === "string" ? rawParams.to : undefined,
  });

  const filters = parsedFilters.success ? parsedFilters.data : {};

  const [transactions, summary, monthlyStats] = await Promise.all([
    getTransactions(filters),
    getSummary(filters),
    getMonthlyStats({ filters }),
  ]);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <Wallet className="h-5 w-5" />
              Finanzas
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Control del dinero de la comparsa: ingresos y gastos por categoría, con resumen y estadísticas mensuales.
              Solo visible para la directiva.
            </p>
          </div>
        </div>

        <FinanceSummaryCards summary={summary} />

        <MonthlyChart stats={monthlyStats} />

        <section className="rounded-xl border bg-card p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Wallet className="h-4 w-4" />
            Registrar movimiento
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">Añade un ingreso o gasto con su categoría y fecha.</p>
          <div className="mt-4">
            <TransactionForm mode="create" />
          </div>
        </section>

        <TransactionFilters />

        <div>
          <h2 className="mb-3 text-sm font-semibold">Transacciones ({transactions.length})</h2>
          <TransactionList items={transactions} />
        </div>
      </div>
    </AppShell>
  );
}
