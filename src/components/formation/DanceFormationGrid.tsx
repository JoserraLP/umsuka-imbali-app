/* eslint-disable @next/next/no-img-element */
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { FormationDetail, AvailableDancer } from "@/lib/formation/queries";
import { assignDancerAction, removeDancerAction, moveDancerAction } from "@/lib/formation/actions";
import { MAX_SEATS_PER_ROW } from "@/lib/formation/schema";

interface Props {
  formation: FormationDetail;
  availableDancers: AvailableDancer[];
  isReadOnly?: boolean;
}

function getSeatLabel(row: number, seat: number): string {
  return `F${row}·A${seat}`;
}

export function DanceFormationGrid({ formation, availableDancers, isReadOnly = false }: Props) {
  const [selectedDancerId, setSelectedDancerId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<{ row: number; seat: number } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const [extraRows, setExtraRows] = useState(0);

  // Build rows map: Map<row, Map<seat, PositionWithMember>>
  const rowsMap = new Map<number, Map<number, typeof formation.positions[number]>>();
  let maxRow = 0;
  for (const pos of formation.positions) {
    maxRow = Math.max(maxRow, pos.rowNumber);
    if (!rowsMap.has(pos.rowNumber)) rowsMap.set(pos.rowNumber, new Map());
    rowsMap.get(pos.rowNumber)!.set(pos.seatNumber, pos);
  }
  // Ensure at least 3 rows visible + extra rows added by user
  const displayRows = Math.max(maxRow, 3) + extraRows;
  const rowNumbers = Array.from({ length: displayRows }, (_, i) => i + 1);

  // Available dancers not yet assigned
  const assignedIds = new Set(formation.positions.map((p) => p.memberId).filter(Boolean));
  const unassigned = availableDancers.filter((d) => !assignedIds.has(d.id));

  const handleSeatClick = (row: number, seat: number) => {
    if (isReadOnly) return;
    const occupants = rowsMap.get(row)?.get(seat);

    // If we have a selected dancer to place
    if (selectedDancerId) {
      if (occupants?.memberId) {
        setMessage("El asiento ya está ocupado.");
        return;
      }
      startTransition(async () => {
        const res = await assignDancerAction({
          formationId: formation.id,
          rowNumber: row,
          seatNumber: seat,
          memberId: selectedDancerId,
        });
        if (!res.success) setMessage(res.error ?? "Error al asignar.");
        else {
          setMessage(null);
          setSelectedDancerId(null);
        }
      });
      return;
    }

    // If we have a selected source to move
    if (selectedSource) {
      // Clicking same source deselects
      if (selectedSource.row === row && selectedSource.seat === seat) {
        setSelectedSource(null);
        return;
      }
      startTransition(async () => {
        const res = await moveDancerAction({
          formationId: formation.id,
          fromRowNumber: selectedSource.row,
          fromSeatNumber: selectedSource.seat,
          toRowNumber: row,
          toSeatNumber: seat,
        });
        if (!res.success) setMessage(res.error ?? "Error al mover.");
        else {
          setMessage(null);
          setSelectedSource(null);
        }
      });
      return;
    }

    // Otherwise: if seat occupied, select it as source or offer to remove
    if (occupants?.memberId) {
      setSelectedSource({ row, seat });
      setMessage(`Seleccionado asiento ${getSeatLabel(row, seat)}. Haz clic en el destino.`);
    } else {
      // Empty seat click with no selection does nothing; hint
      setMessage("Selecciona una bailarina del panel para asignarla.");
    }
  };

  const handleRemove = (row: number, seat: number) => {
    if (isReadOnly) return;
    startTransition(async () => {
      const res = await removeDancerAction({
        formationId: formation.id,
        rowNumber: row,
        seatNumber: seat,
      });
      if (!res.success) setMessage(res.error ?? "Error al quitar.");
      else setMessage(null);
    });
  };

  const handlePrint = () => {
    if (typeof window !== "undefined") window.print();
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-semibold">Plano — {formation.name}</h3>
          <p className="text-sm text-muted-foreground">
            Filas de {MAX_SEATS_PER_ROW} juntas. {isReadOnly ? "Solo lectura." : "Haz clic para asignar/mover."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handlePrint} className="print:hidden">
          Imprimir
        </Button>
      </div>

      {message && (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">{message}</div>
      )}

      {/* Available dancers panel */}
      {!isReadOnly && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Bailarinas sin asignar</CardTitle>
            <CardDescription>
              {unassigned.length === 0 ? "Todas las bailarinas están asignadas." : "Selecciona una y luego haz clic en un asiento vacío."}
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {unassigned.map((d) => (
              <button
                key={d.id}
                onClick={() => {
                  setSelectedDancerId(d.id);
                  setSelectedSource(null);
                  setMessage(`Bailarina seleccionada: ${d.firstName} ${d.lastName}. Haz clic en un asiento vacío.`);
                }}
                className={`rounded-full border px-3 py-1 text-sm transition-colors ${selectedDancerId === d.id ? "bg-primary text-primary-foreground" : "bg-card hover:bg-accent"}`}
                disabled={isPending}
              >
                {d.firstName} {d.lastName}
              </button>
            ))}
            {selectedDancerId && (
              <Button variant="ghost" size="sm" onClick={() => setSelectedDancerId(null)} disabled={isPending}>
                Cancelar selección
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Grid - 6 juntas sin pasillo */}
      <div className="space-y-2 print:space-y-2" id="formation-grid">
        {rowNumbers.map((row) => (
          <div key={row} className="flex items-center justify-center gap-1">
            <span className="w-8 text-center text-xs font-mono text-muted-foreground">F{row}</span>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5, 6].map((seat) => {
                const pos = rowsMap.get(row)?.get(seat);
                const isSelectedSource = selectedSource?.row === row && selectedSource?.seat === seat;
                return (
                  <SeatCard
                    key={`${row}-${seat}`}
                    row={row}
                    seat={seat}
                    occupant={pos ?? null}
                    isSelected={isSelectedSource}
                    isPending={isPending}
                    isReadOnly={isReadOnly}
                    onClick={() => handleSeatClick(row, seat)}
                    onRemove={() => handleRemove(row, seat)}
                  />
                );
              })}
            </div>
          </div>
        ))}
      </div>
      {!isReadOnly && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => setExtraRows((c) => c + 1)} disabled={isPending}>
            + Añadir fila
          </Button>
        </div>
      )}

      <style>{`@media print { .print\\:hidden { display: none !important; } #formation-grid { zoom: 0.9; } }`}</style>

      {selectedSource && !isReadOnly && (
        <div className="flex gap-2">
          <Badge variant="secondary">Origen: {getSeatLabel(selectedSource.row, selectedSource.seat)}</Badge>
          <Button variant="ghost" size="sm" onClick={() => setSelectedSource(null)}>
            Cancelar movimiento
          </Button>
        </div>
      )}
    </div>
  );
}

function SeatCard({
  row,
  seat,
  occupant,
  isSelected,
  isPending,
  isReadOnly,
  onClick,
  onRemove,
}: {
  row: number;
  seat: number;
  occupant: { memberId: string | null; firstName: string | null; lastName: string | null; avatarUrl: string | null } | null;
  isSelected: boolean;
  isPending: boolean;
  isReadOnly: boolean;
  onClick: () => void;
  onRemove: () => void;
}) {
  const occupied = !!occupant?.memberId;
  return (
    <div
      className={`relative flex h-20 w-20 flex-col items-center justify-center rounded-lg border text-center transition-colors ${
        occupied ? "bg-primary/10 border-primary/30" : "bg-card border-dashed"
      } ${isSelected ? "ring-2 ring-primary" : ""} ${!isReadOnly ? "cursor-pointer hover:bg-accent" : ""}`}
      onClick={onClick}
      role="button"
      tabIndex={isReadOnly ? -1 : 0}
      aria-label={`Fila ${row} asiento ${seat} ${occupied ? `${occupant?.firstName} ${occupant?.lastName}` : "vacío"}`}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !isReadOnly) {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <span className="absolute left-1 top-1 text-[10px] font-mono text-muted-foreground">
        {seat}
      </span>
      {occupied ? (
        <>
          {occupant?.avatarUrl ? (
            <img src={occupant.avatarUrl} alt="" className="h-8 w-8 rounded-full object-cover" />
          ) : (
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary text-xs text-primary-foreground">
              {(occupant?.firstName?.[0] ?? "?") + (occupant?.lastName?.[0] ?? "")}
            </div>
          )}
          <span className="mt-1 max-w-[72px] truncate text-[11px] font-medium leading-none">
            {occupant?.firstName} {occupant?.lastName}
          </span>
          {!isReadOnly && (
            <button
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              disabled={isPending}
              className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-[10px] text-destructive-foreground hover:bg-destructive/90"
              aria-label="Quitar bailarina"
            >
              ×
            </button>
          )}
        </>
      ) : (
        <span className="text-xs text-muted-foreground">Vacío</span>
      )}
    </div>
  );
}
