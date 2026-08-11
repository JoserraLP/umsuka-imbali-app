"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  assignMemberToShiftAction,
  unassignMemberFromShiftAction,
} from "@/app/events/[id]/shift-actions";
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
  const [error, setError] = useState<string | null>(null);
  const isFull = maxAssignees !== null && assignments.length >= maxAssignees;

  const assignedUserIds = new Set(assignments.map((a) => a.userId));

  // Sprint 12: each shift is covered by specific members of the group,
  // so the selector lists the group's members (or all active members for
  // shifts without a workgroup filter) with a toggle per member.
  const eligibleMembers = availableMembers.filter((m) => {
    if (workgroupFilter && workgroupFilter !== "ninguno" && m.workgroup !== workgroupFilter) {
      return false;
    }
    return true;
  });

  async function handleToggle(member: MemberOption, isAssigned: boolean) {
    setError(null);
    const result = isAssigned
      ? await unassignMemberFromShiftAction({
          assignmentId: assignments.find((a) => a.userId === member.id)?.id ?? "",
          eventId,
        })
      : await assignMemberToShiftAction({ shiftId, userId: member.id, eventId });

    if (result.success) {
      router.refresh();
    } else {
      setError(result.error ?? "Error al actualizar la asignación.");
    }
  }

  return (
    <div className="space-y-2">
      <span className="text-xs text-muted-foreground">
        {assignments.length}
        {maxAssignees !== null ? ` / ${maxAssignees}` : ""} asignados
        {workgroupFilter && workgroupFilter !== "ninguno" && ` · Grupo: ${workgroupFilter}`}
      </span>

      {eligibleMembers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {workgroupFilter && workgroupFilter !== "ninguno"
            ? "No hay miembros en este grupo."
            : "No hay miembros disponibles."}
        </p>
      ) : (
        <ul className="space-y-1">
          {eligibleMembers.map((member) => {
            const isAssigned = assignedUserIds.has(member.id);
            const canToggle = canManage && !(isFull && !isAssigned);
            return (
              <li
                key={member.id}
                className="flex items-center gap-2 rounded-md bg-muted/30 px-3 py-1.5 text-sm"
              >
                <input
                  type="checkbox"
                  id={`assign-${member.id}`}
                  checked={isAssigned}
                  disabled={!canToggle}
                  onChange={() => handleToggle(member, isAssigned)}
                  className="h-4 w-4 shrink-0 accent-primary"
                />
                <label
                  htmlFor={`assign-${member.id}`}
                  className={`flex-1 ${!canToggle && !isAssigned ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
                >
                  {member.firstName} {member.lastName}
                  {member.workgroup !== "ninguno" && (
                    <span className="ml-1 text-xs text-muted-foreground">({member.workgroup})</span>
                  )}
                </label>
                {isFull && !isAssigned && (
                  <span className="text-xs text-muted-foreground">Turno completo</span>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
