import { getEligibilityForEvent } from "@/lib/payments/queries";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { CreditCard } from "lucide-react";
import { ExportPaymentsButton } from "@/app/events/[id]/export-payments-button";

export async function PaymentEligibility({ eventId }: { eventId: string }) {
  const { eligible, pending } = await getEligibilityForEvent(eventId).catch(() => ({ eligible: [], pending: [] }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <CreditCard className="h-4 w-4" />
          Reparto de material — Elegibilidad
        </CardTitle>
        <CardDescription>Solo los miembros con cuota al día hasta el mes del evento pueden recibir material.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div>
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Elegibles ({eligible.length}) — pueden recibir material</h3>
            <ExportPaymentsButton eligible={eligible} pending={pending} />
          </div>
          {eligible.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Ningún miembro al día.</p>
          ) : (
            <ul className="mt-2 max-h-64 overflow-y-auto rounded border p-2 text-sm">
              {eligible.map((e) => (
                <li key={e.userId} className="flex items-center gap-2 py-1">
                  <Badge variant="default" className="h-5">OK</Badge>
                  {e.displayName ?? e.userId.slice(0, 8)}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <h3 className="text-sm font-semibold">Pendientes de pago ({pending.length}) — no pueden recibir material</h3>
          {pending.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">Todos al día.</p>
          ) : (
            <ul className="mt-2 max-h-64 overflow-y-auto rounded border p-2 text-sm">
              {pending.map((p) => (
                <li key={p.userId} className="flex items-center gap-2 py-1">
                  <Badge variant="secondary" className="h-5">Pendiente</Badge>
                  {p.displayName ?? p.userId.slice(0, 8)}
                </li>
              ))}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
