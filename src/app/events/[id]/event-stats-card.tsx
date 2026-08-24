import { Badge } from "@/components/ui/badge";
import type { RehearsalSession } from "@/types/database.types";
import type { AttendanceSummary } from "@/lib/attendance/queries";
import type { RehearsalAttendanceRecord } from "@/lib/rehearsals/queries";
import { computeRate } from "@/lib/stats/stats";
import { computeParticipationFromCounts } from "@/lib/rehearsals/stats";

interface EventStatsCardProps {
  /** Aggregate of the generic attendance table (non-rehearsal events). */
  summary: AttendanceSummary | null;
  /** Per-session rows (rehearsal events). */
  rehearsalRecords: RehearsalAttendanceRecord[] | null;
  /** Enabled sessions of the rehearsal (at least one by constraint). */
  sessions: RehearsalSession[];
}

const SESSION_LABELS: Record<RehearsalSession, string> = {
  morning: "Mañana",
  afternoon: "Tarde",
};

/**
 * Compact aggregate stats for management on the event detail page:
 * present/absent/rate for regular events, global participation plus
 * per-session chips for rehearsals. Presentational only — every input
 * is data the page already fetched.
 */
export function EventStatsCard({ summary, rehearsalRecords, sessions }: EventStatsCardProps) {
  return (
    <div className="space-y-2 rounded-lg border bg-muted/40 p-4">
      {summary !== null ? <AttendanceStats summary={summary} /> : null}
      {rehearsalRecords !== null ? (
        <RehearsalStats records={rehearsalRecords} sessions={sessions} />
      ) : null}
    </div>
  );
}

function AttendanceStats({ summary }: { summary: AttendanceSummary }) {
  const rate = computeRate(summary.present, summary.total);

  // Min total 1 keeps the bar segments well-defined when nothing is marked.
  const total = Math.max(1, summary.total);

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Asistencia: {summary.present} presentes · {summary.absent} ausentes ·{" "}
        {rate === null ? "—" : `${rate}%`} de asistencia
      </p>
      <div className="flex h-1.5 w-full overflow-hidden rounded bg-muted">
        <div
          className="h-full bg-green-500"
          style={{ width: `${(summary.present / total) * 100}%` }}
        />
        <div
          className="h-full bg-red-300"
          style={{ width: `${(summary.absent / total) * 100}%` }}
        />
      </div>
    </>
  );
}

function RehearsalStats({
  records,
  sessions,
}: {
  records: RehearsalAttendanceRecord[];
  sessions: RehearsalSession[];
}) {
  const attended = records.filter((record) => record.attended).length;
  const participation = computeParticipationFromCounts(attended, records.length);

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Participación global: {attended}/{records.length} (
        {participation === null ? "—" : `${participation}%`})
      </p>
      <div className="flex flex-wrap gap-1.5">
        {sessions.map((session) => {
          const sessionRecords = records.filter((record) => record.session === session);
          const sessionAttended = sessionRecords.filter((record) => record.attended).length;
          const rate = computeParticipationFromCounts(sessionAttended, sessionRecords.length);
          return (
            <Badge key={session} variant="outline">
              {SESSION_LABELS[session]}: {sessionAttended}/{sessionRecords.length}(
              {rate === null ? "—" : `${rate}%`})
            </Badge>
          );
        })}
      </div>
    </>
  );
}
