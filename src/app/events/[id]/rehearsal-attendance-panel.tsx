"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  markRehearsalAttendanceAction,
  clearRehearsalSessionAction,
} from "@/app/events/[id]/rehearsal-actions";
import { SESSION_LABELS, type MarkRehearsalAttendanceInput } from "@/lib/rehearsals/schema";
import type { RehearsalSession } from "@/types/database.types";

interface AttendeeInfo {
  userId: string;
  firstName: string;
  lastName: string;
}

interface SessionRecordInfo {
  userId: string;
  session: RehearsalSession;
  attended: boolean;
}

interface RehearsalAttendancePanelProps {
  eventId: string;
  /** Enabled sessions of this rehearsal (at least one). */
  sessions: RehearsalSession[];
  attendees: AttendeeInfo[];
  records: SessionRecordInfo[];
}

/** Per-session mark state: true = present, false = absent, null = unmarked. */
type SessionMarkState = boolean | null;

export function RehearsalAttendancePanel({
  eventId,
  sessions,
  attendees,
  records,
}: RehearsalAttendancePanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // userId -> session -> attended
  const marksByUser = useMemo(() => {
    const map = new Map<string, Map<RehearsalSession, boolean>>();
    for (const record of records) {
      let bySession = map.get(record.userId);
      if (!bySession) {
        bySession = new Map<RehearsalSession, boolean>();
        map.set(record.userId, bySession);
      }
      bySession.set(record.session, record.attended);
    }
    return map;
  }, [records]);

  function handleToggle(userId: string, session: RehearsalSession, current: SessionMarkState) {
    setError(null);
    // Unmarked rows behave like an implicit "absent" when toggled on.
    const nextAttended = current !== true;

    startTransition(async () => {
      const input: MarkRehearsalAttendanceInput = {
        eventId,
        userId,
        session,
        attended: nextAttended,
      };
      const result = await markRehearsalAttendanceAction(input);

      if (!result.success) {
        console.error("Error al marcar asistencia al ensayo:", result.error);
        setError(result.error ?? "No se pudo actualizar la asistencia.");
        return;
      }

      router.refresh();
    });
  }

  function handleClear(session: RehearsalSession) {
    setError(null);
    startTransition(async () => {
      const result = await clearRehearsalSessionAction({ eventId, session });

      if (!result.success) {
        console.error("Error al limpiar la sesión:", result.error);
        setError(result.error ?? "No se pudo limpiar la sesión.");
        return;
      }

      router.refresh();
    });
  }

  const markedCount = records.length;
  const presentCount = records.filter((r) => r.attended).length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
        <Badge variant="secondary">{presentCount} presentes</Badge>
        <Badge variant="outline">{markedCount - presentCount} ausentes</Badge>
        <Badge variant="outline">
          {attendees.length * sessions.length - markedCount} sin marcar
        </Badge>
      </div>

      {attendees.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay miembros inscritos para marcar asistencia.
        </p>
      ) : (
        <div className="flex flex-col gap-1">
          {attendees.map((attendee) => {
            const bySession = marksByUser.get(attendee.userId);

            return (
              <div
                key={attendee.userId}
                className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm"
              >
                <span className="font-medium">
                  {attendee.firstName} {attendee.lastName}
                </span>

                <div className="flex flex-col gap-1.5">
                  {sessions.map((session) => {
                    const attended = bySession?.get(session) ?? null;

                    return (
                      <div
                        key={session}
                        className="flex flex-wrap items-center justify-between gap-2 rounded border border-dashed px-2 py-1.5"
                      >
                        <span className="text-xs font-medium text-muted-foreground">
                          Sesión de {SESSION_LABELS[session].toLowerCase()}
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
                            <span className="text-xs text-muted-foreground">Sin marcar</span>
                          )}
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() =>
                              handleToggle(attendee.userId, session, attended)
                            }
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
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {sessions.map((session) => (
          <Button
            key={session}
            type="button"
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() => handleClear(session)}
          >
            Limpiar sesión de {SESSION_LABELS[session].toLowerCase()}
          </Button>
        ))}
      </div>

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
