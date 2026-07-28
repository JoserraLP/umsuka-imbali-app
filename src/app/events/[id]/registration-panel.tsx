"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  registerForEventAction,
  unregisterFromEventAction,
} from "@/app/events/[id]/registration-actions";

interface Attendee {
  registrationId: string;
  userId: string;
  firstName: string;
  lastName: string;
}

interface RegistrationPanelProps {
  eventId: string;
  isViewerRegistered: boolean;
  count: number;
  capacity: number | null;
  attendees: Attendee[];
  canManageAttendees: boolean;
}

export function RegistrationPanel({
  eventId,
  isViewerRegistered,
  count,
  capacity,
  attendees,
  canManageAttendees,
}: RegistrationPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const isFull = capacity !== null && count >= capacity;

  function handleRegister() {
    setError(null);
    startTransition(async () => {
      const result = await registerForEventAction({ eventId });

      if (!result.success) {
        console.error("Error al inscribirse en el evento:", result.error);
        setError(result.error ?? "No se pudo completar la inscripción.");
        return;
      }

      router.refresh();
    });
  }

  function handleUnregister(targetUserId?: string) {
    setError(null);
    startTransition(async () => {
      const result = await unregisterFromEventAction({ eventId, userId: targetUserId });

      if (!result.success) {
        console.error("Error al darse de baja del evento:", result.error);
        setError(result.error ?? "No se pudo completar la baja.");
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {capacity !== null ? `${count} / ${capacity} plazas` : `${count} inscritos`}
        </p>
        {isViewerRegistered ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => handleUnregister()}
          >
            {isPending ? "Guardando…" : "Darme de baja"}
          </Button>
        ) : (
          <Button size="sm" disabled={isPending || isFull} onClick={handleRegister}>
            {isPending ? "Guardando…" : isFull ? "Sin plazas" : "Apuntarme"}
          </Button>
        )}
      </div>

      {capacity !== null && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.min(100, (count / capacity) * 100)}%` }}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {canManageAttendees && (
        <div className="flex flex-col gap-2 border-t pt-4">
          <p className="text-sm font-medium">Inscritos ({attendees.length})</p>
          {attendees.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nadie se ha inscrito todavía.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {attendees.map((attendee) => (
                <li key={attendee.userId} className="flex items-center justify-between text-sm">
                  <span>
                    {attendee.firstName} {attendee.lastName}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={isPending}
                    onClick={() => handleUnregister(attendee.userId)}
                  >
                    Quitar
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
