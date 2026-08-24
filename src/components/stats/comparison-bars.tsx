import { computeDelta } from "@/lib/stats/stats";

interface ComparisonBarsProps {
  mine: number | null;
  average: number | null;
}

/**
 * Compares the caller's shift attendance against their workgroup
 * average (pure CSS horizontal bars, same approach as ResultsChart).
 * The average is a group aggregate computed by a SECURITY DEFINER RPC —
 * no individual member data is involved, hence no privacy wording here.
 */
export function ComparisonBars({ mine, average }: ComparisonBarsProps) {
  if (mine === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Aún no tienes turnos marcados.
      </p>
    );
  }

  if (average === null) {
    return (
      <p className="text-sm text-muted-foreground">
        Tu grupo aún no tiene turnos marcados para comparar.
      </p>
    );
  }

  const delta = computeDelta(mine, average);

  return (
    <div className="space-y-4">
      <ComparisonRow label="Tú" value={mine} />
      <ComparisonRow label="Media del grupo" value={average} />
      {delta !== null && (
        <p className="text-xs text-muted-foreground">
          {delta > 0 &&
            `Estás ${delta} puntos por encima de la media de tu grupo.`}
          {delta < 0 &&
            `Estás ${Math.abs(delta)} puntos por debajo de la media de tu grupo.`}
          {delta === 0 && "Estás en línea con la media de tu grupo."}
        </p>
      )}
    </div>
  );
}

function ComparisonRow({ label, value }: { label: string; value: number }) {
  const clamped = Math.min(100, Math.max(0, value));

  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
        <span className="font-medium">{label}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{value}%</span>
      </div>
      <div className="h-2 rounded bg-muted">
        <div className="h-full rounded bg-primary" style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}
