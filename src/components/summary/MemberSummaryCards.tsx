import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { MemberSummary } from "@/lib/summary/queries";
import { Wallet, MapPin, Music, AlertCircle, CheckCircle2 } from "lucide-react";

interface Props {
  summary: MemberSummary;
  showDetailLink?: boolean;
  compact?: boolean;
}

export function MemberSummaryCards({ summary, showDetailLink = true, compact = false }: Props) {
  const paymentColor = summary.payment.status === "al_dia" ? "text-green-600" : "text-destructive";
  const paymentBg = summary.payment.status === "al_dia" ? "bg-green-50 border-green-200" : "bg-red-50 border-red-200";
  const PaymentIcon = summary.payment.status === "al_dia" ? CheckCircle2 : AlertCircle;

  return (
    <div className={`grid gap-3 ${compact ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-3"}`}>
      {/* Pago */}
      <Card className={`${paymentBg} ${compact ? "p-0" : ""}`}>
        <CardHeader className={compact ? "p-3 pb-1" : "pb-2"}>
          <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
            <Wallet className={`h-4 w-4 ${paymentColor}`} /> Pago
          </CardTitle>
        </CardHeader>
        <CardContent className={compact ? "p-3 pt-0" : "pt-0"}>
          <div className="flex items-center gap-1.5">
            <PaymentIcon className={`h-4 w-4 ${paymentColor}`} />
            <span className={`text-sm font-semibold ${paymentColor}`}>{summary.payment.label}</span>
          </div>
          {summary.payment.detail && !compact && (
            <p className="mt-1 text-xs text-muted-foreground">{summary.payment.detail}</p>
          )}
          {showDetailLink && (
            <Link href="/payments" className="mt-1 inline-block text-xs text-muted-foreground hover:text-foreground">
              Ver pagos →
            </Link>
          )}
        </CardContent>
      </Card>

      {/* Posición baile */}
      <Card>
        <CardHeader className={compact ? "p-3 pb-1" : "pb-2"}>
          <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
            <MapPin className="h-4 w-4 text-muted-foreground" /> Posición
          </CardTitle>
        </CardHeader>
        <CardContent className={compact ? "p-3 pt-0" : "pt-0"}>
          <p className={`text-sm font-medium ${summary.dancePosition.assigned ? "text-foreground" : "text-muted-foreground"}`}>
            {summary.dancePosition.label}
          </p>
          {summary.dancePosition.formationName && <p className="text-xs text-muted-foreground">{summary.dancePosition.formationName}</p>}
          {summary.dancePosition.assigned && showDetailLink && summary.dancePosition.formationId && (
            <Link href={`/formation/${summary.dancePosition.formationId}`} className="mt-1 inline-block text-xs text-muted-foreground hover:text-foreground">
              Ver formación →
            </Link>
          )}
          {!summary.dancePosition.assigned && showDetailLink && (
            <Link href="/formation" className="mt-1 inline-block text-xs text-muted-foreground hover:text-foreground">
              Ver formaciones →
            </Link>
          )}
        </CardContent>
      </Card>

      {/* Instrumento */}
      <Card>
        <CardHeader className={compact ? "p-3 pb-1" : "pb-2"}>
          <CardTitle className="flex items-center gap-1.5 text-sm font-medium">
            <Music className="h-4 w-4 text-muted-foreground" /> Instrumento
          </CardTitle>
        </CardHeader>
        <CardContent className={compact ? "p-3 pt-0" : "pt-0"}>
          <p className={`text-sm font-medium ${summary.instrument.assigned ? "text-foreground" : "text-muted-foreground"}`}>
            {summary.instrument.label}
          </p>
          {summary.instrument.category && <p className="text-xs text-muted-foreground">{summary.instrument.category}</p>}
          {showDetailLink && (
            <Link href="/instruments" className="mt-1 inline-block text-xs text-muted-foreground hover:text-foreground">
              Ver instrumentos →
            </Link>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export function MemberSummaryHeader({ summary }: { summary: MemberSummary }) {
  return (
    <div className="flex flex-wrap gap-2">
      <Badge variant={summary.payment.status === "al_dia" ? "default" : "destructive"}>💰 {summary.payment.label}</Badge>
      <Badge variant={summary.dancePosition.assigned ? "secondary" : "outline"}>💃 {summary.dancePosition.label}</Badge>
      <Badge variant={summary.instrument.assigned ? "secondary" : "outline"}>🎸 {summary.instrument.label}</Badge>
    </div>
  );
}
