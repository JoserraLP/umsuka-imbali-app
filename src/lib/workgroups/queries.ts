import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import type {
  ActiveWorkgroup,
  WorkgroupLeadInfo,
  WorkgroupAttendanceRecord,
  WorkgroupAttendanceSummary,
} from "@/lib/workgroups/schema";
import { ACTIVE_WORKGROUPS } from "@/lib/workgroups/schema";

/**
 * Returns all workgroup attendance records for a given shift, enriched
 * with attendee profile names using the two-query + in-memory-join pattern.
 */
export async function getWorkgroupAttendanceByShift(
  shiftId: string,
): Promise<WorkgroupAttendanceRecord[]> {
  const supabase = await createClient();

  const { data: records, error } = await supabase
    .from("workgroup_attendance")
    .select("id, shift_id, user_id, workgroup, attended, marked_by, created_at, updated_at")
    .eq("shift_id", shiftId)
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(
      `Failed to fetch workgroup attendance for shift ${shiftId}: ${error.message}`,
    );
  }

  const userIds = (records ?? [])
    .map((row) => row.user_id)
    .filter((id): id is string => id !== null);

  const profilesById = new Map<string, { first_name: string; last_name: string }>();

  if (userIds.length > 0) {
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, first_name, last_name")
      .in("id", userIds);

    if (profilesError) {
      throw new Error(`Failed to fetch attendee profiles: ${profilesError.message}`);
    }

    for (const profile of profiles ?? []) {
      profilesById.set(profile.id, {
        first_name: profile.first_name,
        last_name: profile.last_name,
      });
    }
  }

  return (records ?? []).map((row) => {
    const profile = row.user_id ? profilesById.get(row.user_id) : undefined;
    return {
      id: row.id,
      shiftId: row.shift_id ?? shiftId,
      userId: row.user_id ?? "",
      workgroup: row.workgroup as ActiveWorkgroup,
      attended: row.attended,
      markedBy: row.marked_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      firstName: profile?.first_name ?? "Miembro",
      lastName: profile?.last_name ?? "",
    };
  });
}

/**
 * Returns all profiles that have a non-ninguno workgroup assignment.
 */
export async function getAllWorkgroupMembers(): Promise<
  { userId: string; firstName: string; lastName: string; workgroup: ActiveWorkgroup }[]
> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, workgroup")
    .neq("workgroup", "ninguno")
    .order("workgroup", { ascending: true })
    .order("first_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch workgroup members: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    userId: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    workgroup: row.workgroup as ActiveWorkgroup,
  }));
}

/**
 * Returns workgroup lead status and workgroup for the current authenticated user.
 */
export async function getCurrentUserWorkgroupLeadStatus(): Promise<WorkgroupLeadInfo> {
  const profile = await requireAuthenticatedProfile();

  return {
    isLead: profile.isWorkgroupLead,
    workgroup: profile.isWorkgroupLead ? (profile.workgroup as ActiveWorkgroup) : null,
  };
}

/**
 * Returns a summary of workgroup attendance counts per workgroup for a given shift.
 */
export async function getWorkgroupAttendanceSummary(
  shiftId: string,
): Promise<WorkgroupAttendanceSummary[]> {
  const supabase = await createClient();

  const { data: records, error } = await supabase
    .from("workgroup_attendance")
    .select("workgroup, attended")
    .eq("shift_id", shiftId);

  if (error) {
    throw new Error(
      `Failed to fetch workgroup attendance summary for shift ${shiftId}: ${error.message}`,
    );
  }

  const summary = new Map<ActiveWorkgroup, { present: number; absent: number; total: number }>();

  for (const wg of ACTIVE_WORKGROUPS) {
    summary.set(wg, { present: 0, absent: 0, total: 0 });
  }

  for (const record of records ?? []) {
    const wg = record.workgroup as ActiveWorkgroup;
    const entry = summary.get(wg);
    if (entry) {
      if (record.attended) {
        entry.present++;
      } else {
        entry.absent++;
      }
      entry.total++;
    }
  }

  return Array.from(summary.entries()).map(([workgroup, stats]) => ({
    workgroup,
    present: stats.present,
    absent: stats.absent,
    unchecked: 0, // unchecked count would need the full membership list
  }));
}
