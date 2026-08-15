"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  registerForEventAction,
  unregisterFromEventAction,
} from "@/app/events/[id]/registration-actions";
import {
  joinWaitlistAction,
  leaveWaitlistAction,
  setWaitlistEntryStatusAction,
  removeWaitlistEntryAction,
} from "@/app/events/[id]/waitlist-actions";
import type { RegistrationStatus, WaitlistEntry } from "@/lib/events/queries";

interface Attendee {
  registrationId: string;
  userId: string;
  firstName: string;
  lastName: string;
}

interface RegistrationPanelProps {
  eventId: string;
  /** Derived state from computeRegistrationStatus (page-level). */
  registrationStatus: RegistrationStatus;
  attendees: Attendee[];
  /** Management-only: full event waitlist. Empty for regular members. */
  waitlist: WaitlistEntry[];
  canManageAttendees: boolean;
}

export function RegistrationPanel({
  eventId,
  registrationStatus,
  attendees,
  waitlist,
  canManageAttendees,
}: RegistrationPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const { capacity, registeredCount, isFull, registrationOpen, viewerStatus } = registrationStatus;

  function run(action: () => Promise<{ success: boolean; error?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await action();

      if (!result.success) {
        setError(result.error ?? "No se pudo completar la operación.");
        return;
      }

      router.refresh();
    });
  }

  const viewerWaitlistPosition =
    viewerStatus === "waitlisted" ? (registrationStatus.viewerWaitlistPosition ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {capacity !== null
            ? `${registeredCount} / ${capacity} plazas`
            : `${registeredCount} inscritos`}
        </p>
        {viewerStatus === "registered" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => void run(() => unregisterFromEventAction({ eventId }))}
          >
            {isPending ? "Guardando…" : "Darme de baja"}
          </Button>
        ) : viewerStatus === "waitlisted" ? (
          <Button
            variant="outline"
            size="sm"
            disabled={isPending}
            onClick={() => void run(() => leaveWaitlistAction({ eventId }))}
          >
            {isPending
              ? "Guardando…"
              : viewerWaitlistPosition !== null
                ? `Abandonar lista de espera (posición #${viewerWaitlistPosition})`
                : "Abandonar lista de espera"}
          </Button>
        ) : registrationOpen ? (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => void run(() => registerForEventAction({ eventId }))}
          >
            {isPending ? "Guardando…" : "Apuntarme"}
          </Button>
        ) : (
          <Button
            size="sm"
            disabled={isPending}
            onClick={() => void run(() => joinWaitlistAction({ eventId }))}
          >
            {isPending ? "Guardando…" : "Apuntarme a la lista de espera"}
          </Button>
        )}
      </div>

      {isFull && (
        <p className="text-xs text-muted-foreground">
          El aforo está completo: al apuntarte entrarás en la lista de espera y ocuparás una plaza
          si alguien se da de baja.
        </p>
      )}

      {capacity !== null && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.min(100, (registeredCount / capacity) * 100)}%` }}
          />
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}

      {canManageAttendees && (
        <div className="flex flex-col gap-4 border-t pt-4">
          <div className="flex flex-col gap-2">
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
                      onClick={() =>
                        void run(() =>
                          unregisterFromEventAction({ eventId, userId: attendee.userId }),
                        )
                      }
                    >
                      Quitar
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">
              Lista de espera ({waitlist.filter((entry) => entry.status === "waiting").length})
            </p>
            {waitlist.length === 0 ? (
              <p className="text-sm text-muted-foreground">No hay nadie en la lista de espera.</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {waitlist.map((entry) => (
                  <li key={entry.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="min-w-0">
                      <span className="text-muted-foreground">#{entry.position}</span>{" "}
                      <span>
                        {entry.firstName} {entry.lastName}
                      </span>
                      {entry.status !== "waiting" && (
                        <span className="ml-2 text-xs text-muted-foreground">({entry.status})</span>
                      )}
                    </span>
                    {entry.status === "waiting" && (
                      <span className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="default"
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            void run(() =>
                              setWaitlistEntryStatusAction({
                                eventId,
                                entryId: entry.id,
                                status: "promoted",
                              }),
                            )
                          }
                        >
                          Promover
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                          onClick={() =>
                            void run(() =>
                              removeWaitlistEntryAction({ eventId, entryId: entry.id }),
                            )
                          }
                        >
                          Quitar
                        </Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
