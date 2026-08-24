import type { MonthlyTrendPoint } from "@/lib/stats/stats";

interface TrendChartProps {
  points: MonthlyTrendPoint[];
}

/**
 * Presentational vertical bar-chart of the monthly attendance trend
 * (pure CSS bars, same approach as the votings results chart). Null
 * rates render an empty track with a dash: "no data" is not the same as
 * a 0% month.
 */
export function TrendChart({ points }: TrendChartProps) {
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">Sin datos</p>;
  }

  const summary = points
    .map((point) => `${point.label} ${point.rate === null ? "—" : `${point.rate}%`}`)
    .join(", ");

  return (
    <div
      role="img"
      aria-label={`Tendencia mensual de asistencia: ${summary}`}
      className="flex h-32 items-end gap-2"
    >
      {points.map((point) => (
        <div key={point.key} className="flex flex-1 flex-col items-center gap-1">
          <span className="text-[10px] text-muted-foreground" aria-hidden="true">
            {point.rate === null ? "···" : `${point.rate}%`}
          </span>
          <div className="relative h-24 w-full rounded bg-muted">
            {point.rate !== null && (
              <div
                // Clamp so a malformed rate can never overflow the track.
                className="absolute bottom-0 w-full rounded-t bg-primary"
                style={{
                  height: `${Math.min(100, Math.max(0, point.rate))}%`,
                }}
              />
            )}
          </div>
          <span className="text-xs text-muted-foreground" aria-hidden="true">
            {point.label}
          </span>
        </div>
      ))}
    </div>
  );
}
