import { createClient } from "@/lib/supabase/server";
import { AuthorizationError } from "@/lib/auth/permissions";
import { getAllWorkgroupMembers } from "@/lib/workgroups/queries";
import { getMemberDetail } from "@/lib/members/queries";
import type { ActiveWorkgroup, BarraTask } from "@/lib/workgroups/schema";
import type { Workgroup } from "@/types/database.types";
import {
  canViewGroupStats,
  computeGroupStats,
  computeMemberStatsDetail,
  type GroupStats,
  type MemberStatsDetail,
  type StatsActor,
} from "@/lib/workgroups/stats";

/**
 * Aggregated attendance stats of a workgroup (per member), for the group
 * lead and super admin. Runs at most 4 queries: members list, attendance
 * rows, shift times and assignment counts — no N+1.
 *
 * THROWS AuthorizationError unless the actor is the lead of that exact
 * group or a super admin (mirrors the RLS of workgroup_attendance).
 */
export async function getGroupStats(
  actor: StatsActor,
  workgroup: Workgroup,
): Promise<GroupStats> {
  if (!canViewGroupStats(actor, workgroup) || workgroup === "ninguno") {
    throw new AuthorizationError();
  }

  const supabase = await createClient();

  const members = await getAllWorkgroupMembers(workgroup);

  const { data: attendance, error: attendanceError } = await supabase
    .from("workgroup_attendance")
    .select("user_id, shift_id, attended, hours_worked")
    .eq("workgroup", workgroup);

  if (attendanceError) {
    throw new Error(
      `Failed to fetch workgroup attendance for ${workgroup}: ${attendanceError.message}`,
    );
  }

  const attendanceRows = attendance ?? [];
  const shiftIds = [
    ...new Set(attendanceRows.map((row) => row.shift_id).filter((id): id is string => Boolean(id))),
  ];

  const shiftTimes = new Map<string, { start: string; end: string }>();
  if (shiftIds.length > 0) {
    const { data: shifts, error: shiftsError } = await supabase
      .from("shifts")
      .select("id, start_time, end_time")
      .in("id", shiftIds);

    if (shiftsError) {
      throw new Error(`Failed to fetch shifts for ${workgroup}: ${shiftsError.message}`);
    }

    for (const shift of shifts ?? []) {
      shiftTimes.set(shift.id, { start: shift.start_time, end: shift.end_time });
    }
  }

  const userIds = members.map((member) => member.userId);
  const assignmentsByUser = new Map<string, number>();
  if (userIds.length > 0) {
    const { data: assignments, error: assignmentsError } = await supabase
      .from("shift_assignments")
      .select("user_id")
      .in("user_id", userIds);

    if (assignmentsError) {
      throw new Error(
        `Failed to fetch shift assignments for ${workgroup}: ${assignmentsError.message}`,
      );
    }

    for (const assignment of assignments ?? []) {
      if (assignment.user_id) {
        assignmentsByUser.set(
          assignment.user_id,
          (assignmentsByUser.get(assignment.user_id) ?? 0) + 1,
        );
      }
    }
  }

  return computeGroupStats(workgroup as ActiveWorkgroup, {
    members,
    attendance: attendanceRows.map((row) => ({
      userId: row.user_id,
      shiftId: row.shift_id,
      attended: row.attended,
      hoursWorked: row.hours_worked,
    })),
    shiftTimes,
    assignmentsByUser,
  });
}

/**
 * Detailed stats (summary + per-shift breakdown) of a single member
 * within a workgroup. Returns null when the profile does not exist.
 * THROWS AuthorizationError for actors without group access and for
 * non-super-admins requesting members outside the group.
 */
export async function getMemberStatsDetail(
  actor: StatsActor,
  workgroup: Workgroup,
  userId: string,
): Promise<MemberStatsDetail | null> {
  if (!canViewGroupStats(actor, workgroup) || workgroup === "ninguno") {
    throw new AuthorizationError();
  }

  const member = await getMemberDetail(userId);

  if (!member) {
    return null;
  }

  // Defense in depth: a lead may only see members of their own group.
  if (actor.role !== "super_admin" && member.workgroup !== workgroup) {
    throw new AuthorizationError();
  }

  const supabase = await createClient();

  const { data: attendance, error: attendanceError } = await supabase
    .from("workgroup_attendance")
    .select("id, shift_id, attended, hours_worked, barra_task")
    .eq("user_id", userId)
    .eq("workgroup", workgroup);

  if (attendanceError) {
    throw new Error(
      `Failed to fetch workgroup attendance for member ${userId}: ${attendanceError.message}`,
    );
  }

  const attendanceRows = attendance ?? [];
  const shiftIds = [
    ...new Set(attendanceRows.map((row) => row.shift_id).filter((id): id is string => Boolean(id))),
  ];

  const shifts = new Map<string, { name: string; eventId: string; start: string; end: string }>();
  const events = new Map<string, { title: string; date: string | null }>();

  if (shiftIds.length > 0) {
    const { data: shiftRows, error: shiftsError } = await supabase
      .from("shifts")
      .select("id, name, event_id, start_time, end_time")
      .in("id", shiftIds);

    if (shiftsError) {
      throw new Error(`Failed to fetch shifts for member ${userId}: ${shiftsError.message}`);
    }

    const eventIds = [
      ...new Set(
        (shiftRows ?? []).map((shift) => shift.event_id).filter((id): id is string => Boolean(id)),
      ),
    ];

    if (eventIds.length > 0) {
      const { data: eventRows, error: eventsError } = await supabase
        .from("events")
        .select("id, title, event_date")
        .in("id", eventIds);

      if (eventsError) {
        throw new Error(`Failed to fetch events for member ${userId}: ${eventsError.message}`);
      }

      for (const event of eventRows ?? []) {
        events.set(event.id, { title: event.title, date: event.event_date });
      }
    }

    for (const shift of shiftRows ?? []) {
      shifts.set(shift.id, {
        name: shift.name,
        eventId: shift.event_id ?? "",
        start: shift.start_time,
        end: shift.end_time,
      });
    }
  }

  const { data: assignments, error: assignmentsError } = await supabase
    .from("shift_assignments")
    .select("user_id")
    .eq("user_id", userId);

  if (assignmentsError) {
    throw new Error(`Failed to fetch shift assignments for member ${userId}: ${assignmentsError.message}`);
  }

  return computeMemberStatsDetail({
    workgroup: workgroup as ActiveWorkgroup,
    userId: member.id,
    firstName: member.firstName,
    lastName: member.lastName,
    attendance: attendanceRows.map((row) => ({
      id: row.id,
      shiftId: row.shift_id,
      attended: row.attended,
      hoursWorked: row.hours_worked,
      barraTask: row.barra_task as BarraTask | null,
    })),
    shifts,
    events,
    assignedShifts: (assignments ?? []).length,
  });
}