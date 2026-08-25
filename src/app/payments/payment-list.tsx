"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { deletePaymentAction } from "@/lib/payments/actions";
import { formatPaymentPeriod } from "@/lib/payments/schema";
import type { PaymentRow } from "@/lib/payments/queries";

interface PaymentListProps {
  items: PaymentRow[];
  members: { id: string; firstName: string; lastName: string }[];
}

function memberName(members: PaymentListProps["members"], userId: string): string {
  const m = members.find((x) => x.id === userId);
  return m ? `${m.firstName} ${m.lastName}` : userId.slice(0, 8);
}

export function PaymentList({ items, members }: PaymentListProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (items.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No hay pagos registrados.</p>;
  }

  async function handleDelete(id: string) {
    if (!confirm("¿Eliminar este pago?")) return;
    setDeleting(id);
    setError(null);
    const res = await deletePaymentAction({ id });
    setDeleting(null);
    if (!res.success) {
      setError(res.error ?? "No se pudo eliminar.");
      return;
    }
    router.refresh();
  }

  return (
    <div className="space-y-2">
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="overflow-x-auto rounded-md border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Miembro</th>
              <th className="px-3 py-2 text-left font-medium">Periodo</th>
              <th className="px-3 py-2 text-left font-medium">Tipo</th>
              <th className="px-3 py-2 text-right font-medium">Importe</th>
              <th className="px-3 py-2 text-left font-medium">Fecha</th>
              <th className="px-3 py-2 text-right font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-t">
                <td className="px-3 py-2">{memberName(members, p.userId)}</td>
                <td className="px-3 py-2">{formatPaymentPeriod({ payment_type: p.paymentType, period_month: p.periodMonth, period_year: p.periodYear })}</td>
                <td className="px-3 py-2">
                  <Badge variant={p.paymentType === "yearly" ? "default" : "secondary"}>{p.paymentType === "yearly" ? "Anual" : "Mensual"}</Badge>
                </td>
                <td className="px-3 py-2 text-right">{p.amount.toFixed(2)} €</td>
                <td className="px-3 py-2">{p.paidAt}</td>
                <td className="px-3 py-2 text-right">
                  <Button variant="outline" size="sm" disabled={deleting === p.id} onClick={() => handleDelete(p.id)}>
                    {deleting === p.id ? "..." : "Eliminar"}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
