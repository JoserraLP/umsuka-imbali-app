import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/app-shell";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import { getAllPayments } from "@/lib/payments/queries";
import { createClient } from "@/lib/supabase/server";
import { CreditCard } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PaymentForm } from "@/app/payments/payment-form";
import { BulkPaymentForm } from "@/app/payments/bulk-payment-form";
import { PaymentList } from "@/app/payments/payment-list";

export const metadata: Metadata = {
  title: "Pagos",
};

export default async function PaymentsPage() {
  const profile = await getCurrentProfile();

  if (!profile) {
    redirect("/auth/login");
  }

  if (!isManagementRole(profile.role)) {
    redirect("/dashboard");
  }

  const [payments, members] = await Promise.all([
    getAllPayments(),
    (async () => {
      const supabase = await createClient();
      const { data } = await supabase
        .from("profiles")
        .select("id, first_name, last_name, is_active, status, deleted_at")
        .eq("is_active", true)
        .eq("status", "active")
        .is("deleted_at", null)
        .order("first_name", { ascending: true });
      return (data ?? []).map((p) => ({
        id: p.id,
        firstName: p.first_name as string,
        lastName: p.last_name as string,
      }));
    })(),
  ]);

  return (
    <AppShell profile={profile}>
      <div className="animate-fade-in space-y-6">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-bold tracking-tight">
              <CreditCard className="h-5 w-5" />
              Pagos y cuotas
            </h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              Registro de cuotas mensuales y anuales. Solo visible para la directiva. Los miembros elegibles para
              reparto de material se calculan automáticamente.
            </p>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Registrar pago</CardTitle>
            <CardDescription>Registra un pago mensual o anual para un miembro.</CardDescription>
          </CardHeader>
          <CardContent>
            <PaymentForm members={members} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Registro masivo mensual</CardTitle>
            <CardDescription>Registra el mismo mes/año para varios miembros a la vez.</CardDescription>
          </CardHeader>
          <CardContent>
            <BulkPaymentForm members={members} />
          </CardContent>
        </Card>

        <div>
          <h2 className="mb-3 text-sm font-semibold">Pagos registrados ({payments.length})</h2>
          <PaymentList items={payments} members={members} />
        </div>
      </div>
    </AppShell>
  );
}
