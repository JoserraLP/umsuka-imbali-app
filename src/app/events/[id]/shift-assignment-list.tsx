"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { assignMemberAction, unassignMemberAction } from "@/app/events/[id]/shift-actions";
import type { AssignmentWithUser, MemberOption } from "@/lib/shifts/queries";
import type { Workgroup } from "@/types/database.types";

interface ShiftAssignmentListProps {
  shiftId: string;
  eventId: string;
  assignments: AssignmentWithUser[];
  availableMembers: MemberOption[];
  maxAssignees: number | null;
  workgroupFilter: Workgroup | null;
  canManage: boolean;
}

export function ShiftAssignmentList({
  shiftId,
  eventId,
  assignments,
  availableMembers,
  maxAssignees,
  workgroupFilter,
  canManage,
}: ShiftAssignmentListProps) {
  const router = useRouter();
  const [selectedUserId, setSelectedUserId] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [isAssigning, setIsAssigning] = useState(false);
  const [unassigningId, setUnassigningId] = useState<string | null>(null);

  const isFull = maxAssignees !== null && assignments.length >= maxAssignees;

  // Filter available members: exclude already assigned + respect workgroup filter
  const assignedUserIds = new Set(assignments.map((a) => a.userId));
  const eligibleMembers = availableMembers.filter((m) => {
    if (assignedUserIds.has(m.id)) return false;
    if (workgroupFilter && workgroupFilter !== "ninguno" && m.workgroup !== workgroupFilter) {
      return false;
    }
    return true;
  });

  async function handleAssign() {
    if (!selectedUserId) return;
    setIsAssigning(true);
    setError(null);

    const result = await assignMemberAction({
      shiftId,
      userId: selectedUserId,
      eventId,
    });

    setIsAssigning(false);

    if (result.success) {
      setSelectedUserId("");
      router.refresh();
    } else {
      setError(result.error ?? "Error al asignar miembro.");
    }
  }

  async function handleUnassign(assignmentId: string) {
    setUnassigningId(assignmentId);
    setError(null);

    const result = await unassignMemberAction({
      assignmentId,
      eventId,
    });

    setUnassigningId(null);

    if (result.success) {
      router.refresh();
    } else {
      setError(result.error ?? "Error al desasignar miembro.");
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {assignments.length}
          {maxAssignees !== null ? ` / ${maxAssignees}` : ""} asignados
          {workgroupFilter && workgroupFilter !== "ninguno" && ` · ${workgroupFilter}`}
        </span>
      </div>

      {/* Assignment list */}
      {assignments.length === 0 ? (
        <p className="text-sm text-muted-foreground">Sin miembros asignados.</p>
      ) : (
        <ul className="space-y-1">
          {assignments.map((a) => (
            <li
              key={a.id}
              className="flex items-center justify-between rounded-md bg-muted/30 px-3 py-1.5 text-sm"
            >
              <span>
                {a.firstName} {a.lastName}
              </span>
              {canManage && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-xs text-destructive hover:text-destructive"
                  disabled={unassigningId === a.id}
                  onClick={() => handleUnassign(a.id)}
                >
                  {unassigningId === a.id ? "…" : "Quitar"}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Assign form */}
      {canManage && (
        <div className="flex items-end gap-2 pt-1">
          <div className="flex-1">
            <Select
              value={selectedUserId}
              onChange={(e) => setSelectedUserId(e.target.value)}
            >
              <option value="">Seleccionar miembro…</option>
              {eligibleMembers.length === 0 ? (
                <option value="" disabled>
                  {isFull
                    ? "Turno completo"
                    : "No hay miembros disponibles"}
                </option>
              ) : (
                eligibleMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.firstName} {m.lastName}
                    {m.workgroup !== "ninguno" ? ` (${m.workgroup})` : ""}
                  </option>
                ))
              )}
            </Select>
          </div>
          <Button
            size="sm"
            onClick={handleAssign}
            disabled={!selectedUserId || isAssigning || isFull}
          >
            {isAssigning ? "…" : "Asignar"}
          </Button>
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
