"use client";

import type { ShiftWithAssignments } from "@/lib/shifts/queries";

interface ShiftTimelineProps {
  shifts: ShiftWithAssignments[];
}

/**
 * Visual timeline that shows shifts as horizontal bars.
 * Time is displayed on the X-axis; shifts are stacked vertically.
 */
export function ShiftTimeline({ shifts }: ShiftTimelineProps) {
  if (shifts.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        No hay turnos para mostrar en la línea temporal.
      </p>
    );
  }

  // Calculate the global time range
  const allTimes = shifts.flatMap((s) => [new Date(s.startTime).getTime(), new Date(s.endTime).getTime()]);
  const globalStart = Math.min(...allTimes);
  const globalEnd = Math.max(...allTimes);
  const totalDuration = globalEnd - globalStart;

  if (totalDuration <= 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        Los turnos no tienen una duración válida para mostrar la línea temporal.
      </p>
    );
  }

  const HOUR_MS = 60 * 60 * 1000;
  const MIN_WIDTH_PERCENT = 3; // minimum 3% width for very short shifts

  // Generate hour markers
  const hourMarkers: number[] = [];
  const startHour = new Date(globalStart);
  startHour.setMinutes(0, 0, 0);
  const endHour = new Date(globalEnd);
  endHour.setMinutes(0, 0, 0);

  for (let h = startHour.getTime(); h <= endHour.getTime() + HOUR_MS; h += HOUR_MS) {
    hourMarkers.push(h);
  }

  const TIME_FORMATTER = new Intl.DateTimeFormat("es-ES", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="space-y-2">
      {/* Time axis header */}
      <div className="relative h-6 overflow-hidden">
        {hourMarkers.map((markerMs) => {
          const left = ((markerMs - globalStart) / totalDuration) * 100;
          return (
            <div
              key={markerMs}
              className="absolute top-0 -translate-x-1/2 text-[10px] text-muted-foreground"
              style={{ left: `${left}%` }}
            >
              {TIME_FORMATTER.format(new Date(markerMs))}
            </div>
          );
        })}
      </div>

      {/* Timeline bars */}
      <div className="relative space-y-1.5">
        {/* Grid lines for each hour */}
        <div className="absolute inset-0">
          {hourMarkers.map((markerMs) => {
            const left = ((markerMs - globalStart) / totalDuration) * 100;
            return (
              <div
                key={`grid-${markerMs}`}
                className="absolute top-0 h-full w-px bg-border/50"
                style={{ left: `${left}%` }}
              />
            );
          })}
        </div>

        {shifts.map((shift) => {
          const shiftStart = new Date(shift.startTime).getTime();
          const shiftEnd = new Date(shift.endTime).getTime();
          const left = ((shiftStart - globalStart) / totalDuration) * 100;
          const width = Math.max(
            ((shiftEnd - shiftStart) / totalDuration) * 100,
            MIN_WIDTH_PERCENT,
          );

          const assignmentCount = shift.assignments.length;
          const maxText = shift.maxAssignees !== null ? ` / ${shift.maxAssignees}` : "";

          return (
            <div key={shift.id} className="relative h-8">
              <div
                className="absolute flex h-full items-center rounded-md bg-primary/10 px-2 text-xs font-medium text-primary"
                style={{ left: `${left}%`, width: `${width}%` }}
                title={`${shift.name}: ${TIME_FORMATTER.format(new Date(shift.startTime))} - ${TIME_FORMATTER.format(new Date(shift.endTime))}`}
              >
                <span className="truncate">{shift.name}</span>
                <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">
                  {assignmentCount}{maxText}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
