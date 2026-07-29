"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  requestAbsenceAction,
  justifyAbsenceAction,
  deleteAbsenceAction,
} from "@/app/events/[id]/absence-actions";

interface AbsenceInfo {
  id: string;
  userId: string;
  firstName: string;
  lastName: string;
  reason: string | null;
  justified: boolean;
}

interface AbsencePanelProps {
  eventId: string;
  absences: AbsenceInfo[];
  canManage: boolean;
  viewerAbsenceId: string | null;
}

export function AbsencePanel({
  eventId,
  absences,
  canManage,
  viewerAbsenceId,
}: AbsencePanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [reason, setReason] = useState("");

  const viewerHasAbsence = viewerAbsenceId !== null;
  const pendingAbsences = absences.filter((a) => !a.justified);

  function handleRequestAbsence() {
    if (!reason.trim()) {
      setError("El motivo es obligatorio.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await requestAbsenceAction({ eventId, reason: reason.trim() });

      if (!result.success) {
        console.error("Error al solicitar ausencia:", result.error);
        setError(result.error ?? "No se pudo registrar la solicitud.");
        return;
      }

      setReason("");
      router.refresh();
    });
  }

  function handleJustify(absenceId: string, justified: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await justifyAbsenceAction({ absenceId, justified });

      if (!result.success) {
        console.error("Error al actualizar la justificación:", result.error);
        setError(result.error ?? "No se pudo actualizar.");
        return;
      }

      router.refresh();
    });
  }

  function handleDelete(absenceId: string) {
    setError(null);
    startTransition(async () => {
      const result = await deleteAbsenceAction({ absenceId });

      if (!result.success) {
        console.error("Error al eliminar la ausencia:", result.error);
        setError(result.error ?? "No se pudo eliminar.");
        return;
      }

      router.refresh();
    });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Section: Request absence (for any authenticated member) */}
      <div className="flex flex-col gap-3">
        <p className="text-sm font-medium">Solicitar ausencia</p>
        {viewerHasAbsence ? (
          <p className="text-sm text-muted-foreground">
            Ya has solicitado ausencia para este evento.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <Label htmlFor="absence-reason" className="sr-only">
              Motivo
            </Label>
            <Input
              id="absence-reason"
              placeholder="Motivo de la ausencia…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={isPending}
            />
            <Button
              type="button"
              size="sm"
              disabled={isPending || !reason.trim()}
              onClick={handleRequestAbsence}
            >
              {isPending ? "Enviando…" : "Solicitar ausencia"}
            </Button>
          </div>
        )}
      </div>

      {/* Section: Manage absences (management only) */}
      {canManage && absences.length > 0 && (
        <div className="flex flex-col gap-3 border-t pt-4">
          <p className="text-sm font-medium">
            Solicitudes de ausencia ({absences.length})
          </p>

          {pendingAbsences.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">Pendientes de justificar:</p>
              {pendingAbsences.map((absence) => (
                <div
                  key={absence.id}
                  className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium">
                      {absence.firstName} {absence.lastName}
                    </span>
                    <Badge variant="outline">Pendiente</Badge>
                  </div>
                  {absence.reason && (
                    <p className="text-xs text-muted-foreground">
                      Motivo: {absence.reason}
                    </p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="default"
                      disabled={isPending}
                      onClick={() => handleJustify(absence.id, true)}
                    >
                      Justificar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      disabled={isPending}
                      onClick={() => handleJustify(absence.id, false)}
                    >
                      No justificar
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      disabled={isPending}
                      onClick={() => handleDelete(absence.id)}
                    >
                      Eliminar
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Already justified absences */}
          {absences.filter((a) => a.justified).length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">Justificadas:</p>
              {absences
                .filter((a) => a.justified)
                .map((absence) => (
                  <div
                    key={absence.id}
                    className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                  >
                    <span>
                      {absence.firstName} {absence.lastName}
                    </span>
                    <div className="flex items-center gap-2">
                      <Badge className="bg-green-100 text-green-700">
                        Justificada
                      </Badge>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        disabled={isPending}
                        onClick={() => handleDelete(absence.id)}
                      >
                        Eliminar
                      </Button>
                    </div>
                  </div>
                ))}
            </div>
          )}
        </div>
      )}

      {/* Status message for viewer's own absence */}
      {!canManage && viewerHasAbsence && absences.length > 0 && (
        <div className="border-t pt-2">
          <p className="text-xs text-muted-foreground">
            Estado de tu solicitud:{" "}
            {absences.find((a) => a.id === viewerAbsenceId)?.justified
              ? "Justificada"
              : "Pendiente de revisión"}
          </p>
        </div>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
