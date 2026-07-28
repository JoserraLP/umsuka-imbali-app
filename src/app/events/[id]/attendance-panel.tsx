"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { markAttendanceAction } from "@/app/events/[id]/attendance-actions";

interface AttendeeInfo {
  userId: string;
  firstName: string;
  lastName: string;
}

interface AttendanceInfo {
  userId: string;
  attended: boolean;
}

interface AttendancePanelProps {
  eventId: string;
  attendees: AttendeeInfo[];
  attendanceRecords: AttendanceInfo[];
}

export function AttendancePanel({
  eventId,
  attendees,
  attendanceRecords,
}: AttendancePanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Build a map of userId -> attended status
  const attendanceByUser = new Map<string, boolean>();
  for (const record of attendanceRecords) {
    attendanceByUser.set(record.userId, record.attended);
  }

  function handleToggle(userId: string, currentAttended: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await markAttendanceAction({
        eventId,
        userId,
        attended: !currentAttended,
      });

      if (!result.success) {
        console.error("Error al marcar asistencia:", result.error);
        setError(result.error ?? "No se pudo actualizar la asistencia.");
        return;
      }

      router.refresh();
    });
  }

  if (attendees.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay miembros inscritos para marcar asistencia.
      </p>
    );
  }

  const presentCount = attendees.filter((a) => attendanceByUser.get(a.userId) === true).length;
  const absentCount = attendees.filter((a) => attendanceByUser.get(a.userId) === false).length;
  const uncheckedCount = attendees.length - presentCount - absentCount;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
        <Badge variant="secondary">{presentCount} presentes</Badge>
        <Badge variant="outline">{absentCount} ausentes</Badge>
        {uncheckedCount > 0 && (
          <Badge variant="outline">{uncheckedCount} sin marcar</Badge>
        )}
      </div>

      <div className="flex flex-col gap-1">
        {attendees.map((attendee) => {
          const attended = attendanceByUser.get(attendee.userId) ?? null;

          return (
            <div
              key={attendee.userId}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span>
                {attendee.firstName} {attendee.lastName}
              </span>
              <div className="flex items-center gap-2">
                {attended === true && (
                  <Badge className="bg-green-100 text-green-700 hover:bg-green-200">
                    Presente
                  </Badge>
                )}
                {attended === false && (
                  <Badge
                    variant="destructive"
                    className="bg-red-100 text-red-700 hover:bg-red-200"
                  >
                    Ausente
                  </Badge>
                )}
                {attended === null && (
                  <span className="text-xs text-muted-foreground">
                    Sin marcar
                  </span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isPending}
                  onClick={() => handleToggle(attendee.userId, attended ?? false)}
                >
                  {isPending
                    ? "…"
                    : attended === true
                      ? "Marcar ausente"
                      : "Marcar presente"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
