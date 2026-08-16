import type { VotingResultsRow } from "@/lib/votings/logic";

interface ResultsChartProps {
  results: VotingResultsRow[];
}

/**
 * Presentational bar-chart of voting results (pure CSS bars).
 */
export function ResultsChart({ results }: ResultsChartProps) {
  if (results.length === 0) {
    return (
      <div className="rounded-xl border bg-card p-6 text-center">
        <p className="text-sm text-muted-foreground">Aún no hay votos.</p>
      </div>
    );
  }

  const totalVotes = results[0]!.totalVotes;

  return (
    <div className="rounded-xl border bg-card">
      <div className="border-b border-border px-5 py-4">
        <h2 className="text-sm font-semibold">
          {totalVotes} {totalVotes === 1 ? "voto" : "votos"}
        </h2>
      </div>
      <div className="space-y-4 px-5 py-4">
        {results.map((row) => {
          // Clamp the bar width between 0 and 100%.
          const clampedPercentage = Math.min(
            100,
            Math.max(0, row.percentage),
          );
          return (
            <div key={row.optionId}>
              <div className="mb-1.5 flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">{row.optionText}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {row.votes} {row.votes === 1 ? "voto" : "votos"} ·{" "}
                  {row.percentage}%
                </span>
              </div>
              <div className="h-2 rounded bg-muted">
                <div
                  className="h-full rounded bg-primary"
                  style={{ width: `${clampedPercentage}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}