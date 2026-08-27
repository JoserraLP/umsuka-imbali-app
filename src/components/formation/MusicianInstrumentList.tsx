"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select } from "@/components/ui/select";
import { assignInstrumentAction, unassignInstrumentAction } from "@/lib/formation/actions";
import type { MusicianInstrumentRow, AvailableInstrument } from "@/lib/formation/queries";

interface Musician {
  id: string;
  firstName: string;
  lastName: string;
}

interface Props {
  formationId: string | null;
  musicians: Musician[];
  assignments: MusicianInstrumentRow[];
  availableInstruments: AvailableInstrument[];
  isReadOnly?: boolean;
}

export function MusicianInstrumentList({
  formationId,
  musicians,
  assignments,
  availableInstruments,
  isReadOnly = false,
}: Props) {
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [selected, setSelected] = useState<Record<string, string>>({});

  const assignedByUser = new Map(assignments.map((a) => [a.userId, a]));

  const handleAssign = (userId: string) => {
    const instrumentId = selected[userId];
    if (!instrumentId) {
      setMessage("Selecciona un instrumento.");
      return;
    }
    startTransition(async () => {
      const res = await assignInstrumentAction({
        userId,
        instrumentId,
        formationId: formationId ?? null,
      });
      if (!res.success) setMessage(res.error ?? "Error al asignar.");
      else {
        setMessage(null);
        setSelected((prev) => ({ ...prev, [userId]: "" }));
      }
    });
  };

  const handleUnassign = (userId: string) => {
    startTransition(async () => {
      const res = await unassignInstrumentAction({
        userId,
        formationId: formationId ?? null,
      });
      if (!res.success) setMessage(res.error ?? "Error al quitar.");
      else setMessage(null);
    });
  };

  // Instruments that are currently assigned should be shown as occupied
  const occupiedInstrumentIds = new Set(assignments.map((a) => a.instrumentId));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Instrumentos de músicos</CardTitle>
        <CardDescription>
          {isReadOnly ? "Consulta de instrumentos asignados." : "Asigna un instrumento del inventario a cada músico (un instrumento por músico y formación)."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {message && (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">{message}</div>
        )}

        {musicians.length === 0 ? (
          <p className="text-sm text-muted-foreground">No hay músicos disponibles.</p>
        ) : (
          <div className="space-y-2">
            {musicians.map((musician) => {
              const assignment = assignedByUser.get(musician.id);
              return (
                <div key={musician.id} className="flex items-center justify-between gap-3 rounded-lg border p-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {musician.firstName} {musician.lastName}
                    </p>
                    {assignment ? (
                      <div className="mt-1 flex items-center gap-2">
                        <Badge variant="secondary">{assignment.instrumentName}</Badge>
                        {assignment.instrumentCategory && (
                          <span className="text-xs text-muted-foreground">{assignment.instrumentCategory}</span>
                        )}
                        <span className="text-xs text-muted-foreground">
                          {new Date(assignment.assignedAt).toLocaleDateString("es-ES")}
                        </span>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">Sin instrumento</p>
                    )}
                  </div>

                  {!isReadOnly && (
                    <div className="flex items-center gap-2">
                      {!assignment ? (
                        <>
                          <Select
                            value={selected[musician.id] ?? ""}
                            onChange={(e) => setSelected((prev) => ({ ...prev, [musician.id]: e.target.value }))}
                            disabled={isPending}
                            className="w-[160px]"
                          >
                            <option value="">Instrumento</option>
                            {availableInstruments.map((inst) => (
                              <option key={inst.id} value={inst.id} disabled={occupiedInstrumentIds.has(inst.id)}>
                                {inst.name} {occupiedInstrumentIds.has(inst.id) ? "(ocupado)" : ""}
                              </option>
                            ))}
                          </Select>
                          {availableInstruments.length === 0 && (
                            <span className="text-xs text-muted-foreground">No hay instrumentos disponibles</span>
                          )}
                          <Button size="sm" onClick={() => handleAssign(musician.id)} disabled={isPending || !selected[musician.id]}>
                            Asignar
                          </Button>
                        </>
                      ) : (
                        <Button variant="outline" size="sm" onClick={() => handleUnassign(musician.id)} disabled={isPending}>
                          Quitar
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {assignments.length > 0 && (
          <div className="border-t pt-3">
            <p className="mb-1 text-xs font-medium">Historial en esta formación</p>
            <ul className="space-y-1">
              {assignments.map((a) => (
                <li key={a.id} className="text-xs text-muted-foreground">
                  {a.firstName} {a.lastName} — {a.instrumentName} ({new Date(a.assignedAt).toLocaleString("es-ES")})
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
