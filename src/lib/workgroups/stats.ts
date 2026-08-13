import type { AppRole } from "@/types/auth";
import type { Workgroup } from "@/types/database.types";
import type { ActiveWorkgroup, BarraTask } from "@/lib/workgroups/schema";

/**
 * Minimal actor context required to evaluate workgroup-stats access.
 * Mirrors the shape of AuthenticatedProfile (src/types/auth.ts) but only
 * carries the fields these rules depend on, so the helpers stay pure and
 * trivially unit-testable without touching the database.
 */
export interface StatsActor {
  role: AppRole;
  isWorkgroupLead: boolean;
  workgroup: Workgroup;
}

/** Aggregated stats row for a single member of a workgroup. */
export interface GroupMemberStat {
  userId: string;
  firstName: string;
  lastName: string;
  assignedShifts: number;
  markedShifts: number;
  attendedShifts: number;
  totalHours: number;
  attendanceRate: number | null;
}

/** Aggregated stats for a whole workgroup, one entry per member. */
export interface GroupStats {
  workgroup: ActiveWorkgroup;
  members: GroupMemberStat[];
}

/** Per-shift breakdown row shown in the member stats detail. */
export interface MemberShiftStat {
  attendanceId: string;
  shiftId: string;
  shiftName: string;
  eventId: string;
  eventTitle: string;
  eventDate: string | null;
  startTime: string;
  endTime: string;
  attended: boolean;
  hours: number;
  barraTask: BarraTask | null;
}

/** Detailed stats for a single member: summary + per-shift breakdown. */
export interface MemberStatsDetail {
  userId: string;
  firstName: string;
  lastName: string;
  workgroup: ActiveWorkgroup;
  assignedShifts: number;
  markedShifts: number;
  attendedShifts: number;
  totalHours: number;
  attendanceRate: number | null;
  shifts: MemberShiftStat[];
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

/**
 * Duration of a shift in hours. Returns 0 when the end time is not after
 * the start time or when either date is invalid.
 */
export function shiftDurationHours(startTime: string, endTime: string): number {
  const start = Date.parse(startTime);
  const end = Date.parse(endTime);

  if (Number.isNaN(start) || Number.isNaN(end)) {
    return 0;
  }

  const diffMs = end - start;
  if (diffMs <= 0) {
    return 0;
  }

  return diffMs / 3_600_000;
}

/**
 * Hours effectively credited for one attendance row: absent rows always
 * count 0 (even when hoursWorked was captured), present rows use the
 * manually marked hours when available and fall back to the shift
 * duration otherwise (e.g. barra, which never stores hoursWorked).
 */
export function computeEffectiveHours(input: {
  attended: boolean;
  hoursWorked: number | null;
  startTime: string;
  endTime: string;
}): number {
  if (!input.attended) {
    return 0;
  }
  if (input.hoursWorked !== null) {
    return input.hoursWorked;
  }
  return shiftDurationHours(input.startTime, input.endTime);
}

/**
 * True when the actor may view stats of `workgroup`. Stricter than the
 * current RLS on workgroup_attendance (defense in depth): only super_admin
 * (is_super_admin()) and the lead of that exact group pass — a plain admin
 * or a regular member does NOT.
 */
export function canViewGroupStats(
  actor: StatsActor | null | undefined,
  workgroup: Workgroup,
): boolean {
  if (!actor) return false;
  if (actor.role === "super_admin") return true;
  if (actor.isWorkgroupLead && actor.workgroup === workgroup && workgroup !== "ninguno") {
    return true;
  }
  return false;
}

export interface GroupStatsInput {
  /** Every member of the workgroup — one stat row each, even without records. */
  members: { userId: string; firstName: string; lastName: string }[];
  /** Workgroup attendance rows of the group (attendance of other groups ignored). */
  attendance: { userId: string; shiftId: string; attended: boolean; hoursWorked: number | null }[];
  /** Shift times keyed by shift id, used when hoursWorked is null. */
  shiftTimes: Map<string, { start: string; end: string }>;
  /** Assigned-shift counts keyed by user id. */
  assignmentsByUser: Map<string, number>;
}

/**
 * Computes the aggregated stats of a workgroup: one row per member
 * (including members without any attendance records), sorted by first
 * name then last name. Hours come from computeEffectiveHours and are
 * rounded to 2 decimals; the attendance rate is rounded to 1 decimal and
 * is null when the member has no marked shifts.
 */
export function computeGroupStats(workgroup: ActiveWorkgroup, input: GroupStatsInput): GroupStats {
  const members = [...input.members]
    .sort(
      (a, b) =>
        a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName),
    )
    .map((member) => {
      const records = input.attendance.filter((row) => row.userId === member.userId);
      const markedShifts = records.length;
      const attendedShifts = records.filter((row) => row.attended).length;

      const totalHours = round(
        records.reduce((sum, row) => {
          const times = input.shiftTimes.get(row.shiftId);
          return (
            sum +
            computeEffectiveHours({
              attended: row.attended,
              hoursWorked: row.hoursWorked,
              startTime: times?.start ?? "",
              endTime: times?.end ?? "",
            })
          );
        }, 0),
        2,
      );

      const attendanceRate =
        markedShifts === 0 ? null : round((attendedShifts / markedShifts) * 100, 1);

      return {
        userId: member.userId,
        firstName: member.firstName,
        lastName: member.lastName,
        assignedShifts: input.assignmentsByUser.get(member.userId) ?? 0,
        markedShifts,
        attendedShifts,
        totalHours,
        attendanceRate,
      };
    });

  return { workgroup, members };
}

export interface MemberStatsDetailInput {
  workgroup: ActiveWorkgroup;
  userId: string;
  firstName: string;
  lastName: string;
  /** Workgroup attendance rows of the member (already scoped to the group). */
  attendance: {
    id: string;
    shiftId: string;
    attended: boolean;
    hoursWorked: number | null;
    barraTask: BarraTask | null;
  }[];
  /** Shift metadata keyed by shift id. */
  shifts: Map<string, { name: string; eventId: string; start: string; end: string }>;
  /** Event metadata keyed by event id. */
  events: Map<string, { title: string; date: string | null }>;
  assignedShifts: number;
}

/**
 * Computes the detailed stats of a single member: the summary counters
 * plus one row per marked shift, sorted by start time descending. Shifts
 * reference events by id with "Evento desconocido" as fallback; hours are
 * rounded to 2 decimals per shift and in the total.
 */
export function computeMemberStatsDetail(input: MemberStatsDetailInput): MemberStatsDetail {
  const markedShifts = input.attendance.length;
  const attendedShifts = input.attendance.filter((row) => row.attended).length;

  const shifts = input.attendance
    .map((row) => {
      const shift = input.shifts.get(row.shiftId);
      const event = shift ? input.events.get(shift.eventId) : undefined;
      const startTime = shift?.start ?? "";
      const endTime = shift?.end ?? "";

      return {
        attendanceId: row.id,
        shiftId: row.shiftId,
        shiftName: shift?.name ?? "Turno sin nombre",
        eventId: shift?.eventId ?? "",
        eventTitle: event?.title ?? "Evento desconocido",
        eventDate: event?.date ?? null,
        startTime,
        endTime,
        attended: row.attended,
        hours: round(
          computeEffectiveHours({
            attended: row.attended,
            hoursWorked: row.hoursWorked,
            startTime,
            endTime,
          }),
          2,
        ),
        barraTask: row.barraTask,
      };
    })
    .sort((a, b) => b.startTime.localeCompare(a.startTime));

  const totalHours = round(
    shifts.reduce((sum, shift) => sum + shift.hours, 0),
    2,
  );

  return {
    userId: input.userId,
    firstName: input.firstName,
    lastName: input.lastName,
    workgroup: input.workgroup,
    assignedShifts: input.assignedShifts,
    markedShifts,
    attendedShifts,
    totalHours,
    attendanceRate: markedShifts === 0 ? null : round((attendedShifts / markedShifts) * 100, 1),
    shifts,
  };
}