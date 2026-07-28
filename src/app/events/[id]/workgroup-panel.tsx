"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
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

const WORKGROUP_LABELS: Record<string, string> = {
  telas: "Telas",
  barra: "Barra",
  estandarte: "Estandarte",
  limpieza: "Limpieza",
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

  // Build a map of userId -> attended status per workgroup
  // Key: `${userId}:${workgroup}`
  const attendanceByKey = new Map<string, boolean>();
  for (const record of attendanceRecords) {
    attendanceByKey.set(`${record.userId}:${record.workgroup}`, record.attended);
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

  function handleToggle(userId: string, workgroup: ActiveWorkgroup, currentAttended: boolean) {
    setError(null);
    startTransition(async () => {
      const result = await markWorkgroupAttendanceAction({
        shiftId,
        userId,
        workgroup,
        attended: !currentAttended,
      });

      if (!result.success) {
        console.error("Error al marcar asistencia:", result.error);
        setError(result.error ?? "No se pudo actualizar la asistencia.");
        return;
      }

      router.refresh();
    });
  }

  // Count totals
  let totalMembers = 0;
  let totalPresent = 0;
  let totalAbsent = 0;
  for (const [, wgMembers] of membersByWorkgroup) {
    for (const member of wgMembers) {
      totalMembers++;
      const attended = attendanceByKey.get(`${member.userId}:${member.workgroup}`);
      if (attended === true) totalPresent++;
      else if (attended === false) totalAbsent++;
    }
  }
  const totalUnchecked = totalMembers - totalPresent - totalAbsent;

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
        {totalUnchecked > 0 && (
          <Badge variant="outline">{totalUnchecked} sin marcar</Badge>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Turno: <span className="font-medium">{shiftName}</span>
      </p>

      {Array.from(membersByWorkgroup.entries()).map(([workgroup, wgMembers]) => {
        if (wgMembers.length === 0) return null;

        const wgPresent = wgMembers.filter(
          (m) => attendanceByKey.get(`${m.userId}:${m.workgroup}`) === true,
        ).length;
        const wgAbsent = wgMembers.filter(
          (m) => attendanceByKey.get(`${m.userId}:${m.workgroup}`) === false,
        ).length;
        const wgUnchecked = wgMembers.length - wgPresent - wgAbsent;

        return (
          <Card key={workgroup}>
            <CardHeader className="py-3">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm font-semibold">
                  {WORKGROUP_LABELS[workgroup] ?? workgroup}
                </CardTitle>
                <div className="flex gap-2 text-xs">
                  <Badge variant="secondary">{wgPresent} presentes</Badge>
                  <Badge variant="outline">{wgAbsent} ausentes</Badge>
                  {wgUnchecked > 0 && (
                    <Badge variant="outline">{wgUnchecked} sin marcar</Badge>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardContent className="py-2">
              <div className="flex flex-col gap-1">
                {wgMembers.map((member) => {
                  const attended = attendanceByKey.get(
                    `${member.userId}:${member.workgroup}`,
                  ) ?? null;

                  return (
                    <div
                      key={`${member.userId}:${member.workgroup}`}
                      className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
                    >
                      <span>
                        {member.firstName} {member.lastName}
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
                          <span className="text-xs text-muted-foreground">
                            Sin marcar
                          </span>
                        )}
                        {canManageWorkgroup(workgroup) && (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={isPending}
                            onClick={() =>
                              handleToggle(member.userId, workgroup, attended ?? false)
                            }
                          >
                            {isPending
                              ? "…"
                              : attended === true
                                ? "Marcar ausente"
                                : "Marcar presente"}
                          </Button>
                        )}
                      </div>
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
