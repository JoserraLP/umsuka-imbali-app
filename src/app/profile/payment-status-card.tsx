import { getPaymentsByUser } from "@/lib/payments/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatPaymentPeriod } from "@/lib/payments/schema";
import { CreditCard } from "lucide-react";

export async function PaymentStatusCard({ userId }: { userId: string }) {
  const payments = await getPaymentsByUser(userId).catch(() => []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-4 w-4" />
          Estado de cuotas
        </CardTitle>
        <CardDescription>Historial de pagos y próximo vencimiento.</CardDescription>
      </CardHeader>
      <CardContent>
        {payments.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sin cuotas registradas.</p>
        ) : (
          <div className="space-y-2">
            {payments.slice(0, 12).map((p) => (
              <div key={p.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                <span>
                  {formatPaymentPeriod({ payment_type: p.paymentType, period_month: p.periodMonth, period_year: p.periodYear })}
                </span>
                <span className="flex items-center gap-2">
                  <Badge variant={p.paymentType === "yearly" ? "default" : "secondary"}>{p.paymentType === "yearly" ? "Anual" : "Mensual"}</Badge>
                  <span>{p.amount.toFixed(2)} €</span>
                </span>
              </div>
            ))}
            {payments.length > 12 && <p className="text-xs text-muted-foreground">Mostrando 12 de {payments.length}.</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
