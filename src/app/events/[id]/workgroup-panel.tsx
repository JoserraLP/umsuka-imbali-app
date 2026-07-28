"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { markWorkgroupAttendanceAction } from "@/app/events/[id]/workgroup-actions";
import type { ActiveWorkgroup, WorkgroupType } from "@/lib/workgroups/schema";
import { ACTIVE_WORKGROUPS } from "@/lib/workgroups/schema";

interface WorkgroupMember {
  userId: string;
  firstName: string;
  lastName: string;
  workgroup: ActiveWorkgroup;
}

interface WorkgroupAttendanceInfo {
  userId: string;
  workgroup: ActiveWorkgroup;
  attended: boolean;
  hoursWorked: number | null;
  barraTask: string | null;
}

interface WorkgroupPanelProps {
  shiftId: string;
  shiftName: string;
  members: WorkgroupMember[];
  attendanceRecords: WorkgroupAttendanceInfo[];
  currentUserWorkgroup: WorkgroupType;
  isLead: boolean;
  isSuperAdmin: boolean;
}

const WORKGROUP_LABELS: Record<ActiveWorkgroup, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
};

/** Per-member form state while the lead is filling in details. */
interface MemberFormState {
  attended: boolean;
  hoursWorked: number | null;
  barraTask: "cocina" | "bebidas" | null;
}

const INITIAL_MEMBER_STATE: MemberFormState = {
  attended: false,
  hoursWorked: null,
  barraTask: null,
};

export function WorkgroupAttendancePanel({
  shiftId,
  shiftName,
  members,
  attendanceRecords,
  currentUserWorkgroup,
  isLead,
  isSuperAdmin,
}: WorkgroupPanelProps) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  // Per-member form state: key = `${userId}:${workgroup}`
  const [formState, setFormState] = useState<Map<string, MemberFormState>>(() => {
    const initial = new Map<string, MemberFormState>();
    // Initialise from existing attendance records
    for (const rec of attendanceRecords) {
      initial.set(`${rec.userId}:${rec.workgroup}`, {
        attended: rec.attended,
        hoursWorked: rec.hoursWorked,
        barraTask: (["cocina", "bebidas"].includes(rec.barraTask ?? "")
          ? (rec.barraTask as "cocina" | "bebidas")
          : null),
      });
    }
    return initial;
  });

  function getMemberState(userId: string, workgroup: ActiveWorkgroup): MemberFormState {
    return formState.get(`${userId}:${workgroup}`) ?? { ...INITIAL_MEMBER_STATE };
  }

  function updateMemberState(
    userId: string,
    workgroup: ActiveWorkgroup,
    patch: Partial<MemberFormState>,
  ) {
    setFormState((prev) => {
      const next = new Map(prev);
      const key = `${userId}:${workgroup}`;
      const current = next.get(key) ?? { ...INITIAL_MEMBER_STATE };
      next.set(key, { ...current, ...patch });
      return next;
    });
  }

  // Group members by workgroup
  const membersByWorkgroup = new Map<ActiveWorkgroup, WorkgroupMember[]>();
  for (const wg of ACTIVE_WORKGROUPS) {
    membersByWorkgroup.set(wg, []);
  }
  for (const member of members) {
    const group = membersByWorkgroup.get(member.workgroup);
    if (group) {
      group.push(member);
    }
  }

  // Determine which workgroups the current user can manage
  const manageableWorkgroups = new Set<ActiveWorkgroup>();
  if (isSuperAdmin) {
    for (const wg of ACTIVE_WORKGROUPS) manageableWorkgroups.add(wg);
  } else if (isLead && currentUserWorkgroup !== "ninguno") {
    manageableWorkgroups.add(currentUserWorkgroup as ActiveWorkgroup);
  }

  function canManageWorkgroup(wg: ActiveWorkgroup): boolean {
    return manageableWorkgroups.has(wg);
  }

  function handleSave(userId: string, workgroup: ActiveWorkgroup) {
    const state = getMemberState(userId, workgroup);
    setError(null);

    startTransition(async () => {
      const result = await markWorkgroupAttendanceAction({
        shiftId,
        userId,
        workgroup,
        attended: state.attended,
        hoursWorked: workgroup === "barra" ? null : state.hoursWorked,
        barraTask: workgroup === "barra" ? state.barraTask : null,
      });

      if (!result.success) {
        console.error("Error al guardar asistencia:", result.error);
        setError(result.error ?? "No se pudo guardar la asistencia.");
        return;
      }

      router.refresh();
    });
  }

  // Count totals
  let totalPresent = 0;
  let totalAbsent = 0;
  for (const [, wgMembers] of membersByWorkgroup) {
    for (const member of wgMembers) {
      const state = getMemberState(member.userId, member.workgroup);
      if (state.attended) totalPresent++;
      else totalAbsent++;
    }
  }

  // Check if there are any workgroup members at all
  const hasAnyMembers = Array.from(membersByWorkgroup.values()).some(
    (wgMembers) => wgMembers.length > 0,
  );

  if (!hasAnyMembers) {
    return (
      <p className="text-sm text-muted-foreground">
        No hay miembros asignados a grupos de trabajo.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
        <Badge variant="secondary">{totalPresent} presentes</Badge>
        <Badge variant="outline">{totalAbsent} ausentes</Badge>
      </div>

      <p className="text-xs text-muted-foreground">
        Turno: <span className="font-medium">{shiftName}</span>
      </p>

      {Array.from(membersByWorkgroup.entries()).map(([workgroup, wgMembers]) => {
        if (wgMembers.length === 0) return null;

        return (
          <Card key={workgroup}>
            <CardHeader className="py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  {WORKGROUP_LABELS[workgroup] ?? workgroup}
                </CardTitle>
              </div>
            </CardHeader>
            <CardContent className="py-2">
              <div className="flex flex-col gap-2">
                {wgMembers.map((member) => {
                  const state = getMemberState(member.userId, member.workgroup);
                  const canEdit = canManageWorkgroup(workgroup);

                  return (
                    <div
                      key={`${member.userId}:${member.workgroup}`}
                      className="flex flex-col gap-2 rounded-md border px-3 py-2 text-sm"
                    >
                      {/* Top row: name + toggle */}
                      <div className="flex items-center justify-between">
                        <span className="font-medium">
                          {member.firstName} {member.lastName}
                        </span>
                        {canEdit && (
                          <div className="flex items-center gap-2">
                            <label className="flex cursor-pointer items-center gap-1.5 text-xs">
                              <input
                                type="checkbox"
                                checked={state.attended}
                                disabled={isPending}
                                onChange={(e) =>
                                  updateMemberState(member.userId, member.workgroup, {
                                    attended: e.target.checked,
                                  })
                                }
                                className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                              />
                              {state.attended ? "Presente" : "Ausente"}
                            </label>
                          </div>
                        )}
                        {!canEdit && (
                          <Badge
                            variant={state.attended ? "secondary" : "outline"}
                            className={
                              state.attended
                                ? "bg-green-100 text-green-700"
                                : "bg-red-100 text-red-700"
                            }
                          >
                            {state.attended ? "Presente" : "Ausente"}
                          </Badge>
                        )}
                      </div>

                      {/* Bottom row: workgroup-specific details */}
                      {canEdit && (
                        <div className="flex flex-wrap items-center gap-3 pl-1">
                          {workgroup === "barra" ? (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">Tarea:</span>
                              <label className="flex cursor-pointer items-center gap-1 text-xs">
                                <input
                                  type="radio"
                                  name={`barra-${member.userId}`}
                                  value="cocina"
                                  checked={state.barraTask === "cocina"}
                                  disabled={isPending}
                                  onChange={() =>
                                    updateMemberState(member.userId, member.workgroup, {
                                      barraTask: "cocina",
                                    })
                                  }
                                  className="h-3.5 w-3.5"
                                />
                                Cocina
                              </label>
                              <label className="flex cursor-pointer items-center gap-1 text-xs">
                                <input
                                  type="radio"
                                  name={`barra-${member.userId}`}
                                  value="bebidas"
                                  checked={state.barraTask === "bebidas"}
                                  disabled={isPending}
                                  onChange={() =>
                                    updateMemberState(member.userId, member.workgroup, {
                                      barraTask: "bebidas",
                                    })
                                  }
                                  className="h-3.5 w-3.5"
                                />
                                Bebidas
                              </label>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">Horas:</span>
                              <Input
                                type="number"
                                min={0}
                                max={24}
                                step={0.5}
                                placeholder="0"
                                disabled={isPending}
                                value={state.hoursWorked ?? ""}
                                onChange={(e) => {
                                  const val = e.target.value;
                                  updateMemberState(member.userId, member.workgroup, {
                                    hoursWorked: val === "" ? null : Number(val),
                                  });
                                }}
                                className="h-7 w-20 px-2 text-xs"
                              />
                            </div>
                          )}

                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() => handleSave(member.userId, member.workgroup)}
                          >
                            {isPending ? "…" : "Guardar"}
                          </Button>
                        </div>
                      )}

                      {/* Read-only details for non-editable view */}
                      {!canEdit && state.attended && (
                        <div className="pl-1 text-xs text-muted-foreground">
                          {workgroup === "barra"
                            ? state.barraTask
                              ? `Tarea: ${state.barraTask === "cocina" ? "Cocina" : "Bebidas"}`
                              : ""
                            : state.hoursWorked
                              ? `${state.hoursWorked} h`
                              : ""}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        );
      })}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
