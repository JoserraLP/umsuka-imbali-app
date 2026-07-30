"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ShiftForm } from "@/app/events/[id]/shift-form";
import { ShiftTimeline } from "@/app/events/[id]/shift-timeline";
import { ShiftAssignmentList } from "@/app/events/[id]/shift-assignment-list";
import {
  createShiftAction,
  updateShiftAction,
  deleteShiftAction,
} from "@/app/events/[id]/shift-actions";
import type { ShiftWithAssignments, MemberOption } from "@/lib/shifts/queries";
import type { ShiftFormValues } from "@/lib/shifts/schema";


interface ShiftManagementPanelProps {
  eventId: string;
  shifts: ShiftWithAssignments[];
  availableMembers: MemberOption[];
  canManage: boolean;
}

function toDatetimeLocalValue(isoDate: string): string {
  const date = new Date(isoDate);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

export function ShiftManagementPanel({
  eventId,
  shifts,
  availableMembers,
  canManage,
}: ShiftManagementPanelProps) {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [editingShiftId, setEditingShiftId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(values: ShiftFormValues & { eventId: string }) {
    return createShiftAction({
      eventId: values.eventId,
      name: values.name,
      startTime: values.startTime,
      endTime: values.endTime,
      maxAssignees: values.maxAssignees,
      workgroup: values.workgroup,
      notes: values.notes,
    });
  }

  async function handleUpdate(values: ShiftFormValues & { eventId: string; id?: string }) {
    if (!values.id) return { success: false, error: "ID de turno no encontrado." };

    return updateShiftAction({
      id: values.id,
      eventId: values.eventId,
      name: values.name,
      startTime: values.startTime,
      endTime: values.endTime,
      maxAssignees: values.maxAssignees,
      workgroup: values.workgroup,
      notes: values.notes,
    });
  }

  async function handleDelete(shiftId: string) {
    if (!confirm("¿Eliminar este turno? También se eliminarán las asignaciones.")) return;

    setError(null);
    const result = await deleteShiftAction(shiftId, eventId);

    if (!result.success) {
      setError(result.error ?? "Error al eliminar el turno.");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-sm font-semibold">
            Turnos ({shifts.length})
          </h4>
          <p className="text-xs text-muted-foreground">
            Crea y asigna turnos para este evento.
          </p>
        </div>
        {canManage && !showCreateForm && (
          <Button size="sm" onClick={() => setShowCreateForm(true)}>
            + Nuevo turno
          </Button>
        )}
      </div>

      {/* Create form */}
      {canManage && showCreateForm && (
        <ShiftForm
          mode="create"
          eventId={eventId}
          onSubmit={handleCreate}
          onCancel={() => setShowCreateForm(false)}
        />
      )}

      {/* Timeline */}
      {shifts.length > 0 && (
        <div className="rounded-lg border p-3">
          <ShiftTimeline shifts={shifts} />
        </div>
      )}

      {/* Shift list */}
      {shifts.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No hay turnos creados para este evento.
        </p>
      ) : (
        <div className="space-y-3">
          {shifts.map((shift) => (
            <div key={shift.id} className="rounded-lg border p-3">
              <div className="mb-2 flex items-start justify-between">
                <div>
                  <h5 className="text-sm font-medium">{shift.name}</h5>
                  <p className="text-xs text-muted-foreground">
                    {new Date(shift.startTime).toLocaleString("es-ES", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}{" "}
                    &rarr;{" "}
                    {new Date(shift.endTime).toLocaleString("es-ES", {
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                    {shift.workgroup && shift.workgroup !== "ninguno" && (
                      <> &middot; Grupo: {shift.workgroup}</>
                    )}
                  </p>
                </div>
                {canManage && (
                  <div className="flex items-center gap-1">
                    {editingShiftId === shift.id ? (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => setEditingShiftId(null)}
                      >
                        Cancelar
                      </Button>
                    ) : (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 text-xs"
                        onClick={() => setEditingShiftId(shift.id)}
                      >
                        Editar
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 text-xs text-destructive hover:text-destructive"
                      onClick={() => handleDelete(shift.id)}
                    >
                      Eliminar
                    </Button>
                  </div>
                )}
              </div>

              {/* Edit form */}
              {canManage && editingShiftId === shift.id && (
                <div className="mb-3">
                  <ShiftForm
                    mode="edit"
                    eventId={eventId}
                    shiftId={shift.id}
                    defaultValues={{
                      name: shift.name,
                      startTime: toDatetimeLocalValue(shift.startTime),
                      endTime: toDatetimeLocalValue(shift.endTime),
                      maxAssignees: shift.maxAssignees,
                      workgroup: shift.workgroup,
                      notes: shift.notes ?? "",
                    }}
                    onSubmit={handleUpdate}
                    onCancel={() => setEditingShiftId(null)}
                  />
                </div>
              )}

              {/* Notes */}
              {shift.notes && (
                <p className="mb-2 text-xs italic text-muted-foreground">
                  {shift.notes}
                </p>
              )}

              {/* Assignments */}
              <ShiftAssignmentList
                shiftId={shift.id}
                eventId={eventId}
                assignments={shift.assignments}
                availableMembers={availableMembers}
                maxAssignees={shift.maxAssignees}
                workgroupFilter={shift.workgroup}
                canManage={canManage}
              />
            </div>
          ))}
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
