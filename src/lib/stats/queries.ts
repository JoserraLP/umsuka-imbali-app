import { createClient } from "@/lib/supabase/server";
import type { ActivityMark } from "@/lib/stats/stats";

/**
 * Personal activity marks for the stats section (/profile/stats).
 *
 * Reads ONLY rows owned by the caller (RLS enforces user_id = auth.uid()
 * on attendance, rehearsal_attendance and workgroup_attendance), then
 * joins event dates / shift start times with two secondary lookups —
 * no N+1. The workgroup average comes from the SECURITY DEFINER RPC so
 * no other member's rows are ever readable.
 */

export interface PersonalActivityMarks {
  eventMarks: ActivityMark[];
  rehearsalMarks: ActivityMark[];
  shiftMarks: ActivityMark[];
}

interface AttendanceRow {
  event_id: string | null;
  attended: boolean;
  created_at: string;
}

interface RehearsalAttendanceRow {
  event_id: string;
  attended: boolean;
}

interface WorkgroupAttendanceRow {
  shift_id: string | null;
  attended: boolean;
}

/**
 * Fetches every attendance mark of a member across the three activity
 * sources. Marks whose date cannot be resolved are DROPPED: streaks and
 * the monthly trend need a real date, so an undated mark would silently
 * corrupt them.
 */
export async function getPersonalActivityMarks(
  userId: string,
): Promise<PersonalActivityMarks> {
  const supabase = await createClient();

  const [attendanceResult, rehearsalResult, workgroupResult] = await Promise.all([
    supabase
      .from("attendance")
      .select("event_id, attended, created_at")
      .eq("user_id", userId),
    supabase
      .from("rehearsal_attendance")
      .select("event_id, attended")
      .eq("user_id", userId),
    supabase
      .from("workgroup_attendance")
      .select("shift_id, attended")
      .eq("user_id", userId),
  ]);

  if (attendanceResult.error) {
    throw new Error(`Failed to fetch attendance: ${attendanceResult.error.message}`);
  }
  if (rehearsalResult.error) {
    throw new Error(
      `Failed to fetch rehearsal attendance: ${rehearsalResult.error.message}`,
    );
  }
  if (workgroupResult.error) {
    throw new Error(
      `Failed to fetch workgroup attendance: ${workgroupResult.error.message}`,
    );
  }

  const attendanceRows = (attendanceResult.data ?? []) as AttendanceRow[];
  const rehearsalRows = (rehearsalResult.data ?? []) as RehearsalAttendanceRow[];
  const workgroupRows = (workgroupResult.data ?? []) as WorkgroupAttendanceRow[];

  // One combined events lookup for both event-based sources; one shifts
  // lookup for the workgroup source.
  const eventIds = [
    ...new Set(
      [
        ...attendanceRows.map((row) => row.event_id),
        ...rehearsalRows.map((row) => row.event_id),
      ].filter((id): id is string => id !== null),
    ),
  ];
  const shiftIds = [
    ...new Set(
      workgroupRows
        .map((row) => row.shift_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  const [eventsResult, shiftsResult] = await Promise.all([
    eventIds.length > 0
      ? supabase.from("events").select("id, event_date").in("id", eventIds)
      : Promise.resolve(null),
    shiftIds.length > 0
      ? supabase.from("shifts").select("id, start_time").in("id", shiftIds)
      : Promise.resolve(null),
  ]);

  if (eventsResult?.error) {
    throw new Error(`Failed to fetch events: ${eventsResult.error.message}`);
  }
  if (shiftsResult?.error) {
    throw new Error(`Failed to fetch shifts: ${shiftsResult.error.message}`);
  }

  const datesByEventId = new Map<string, string>();
  for (const event of (eventsResult?.data ?? []) as Array<{
    id: string;
    event_date: string | null;
  }>) {
    if (event.event_date) {
      datesByEventId.set(event.id, event.event_date);
    }
  }

  const startTimesByShiftId = new Map<string, string>();
  for (const shift of (shiftsResult?.data ?? []) as Array<{
    id: string;
    start_time: string | null;
  }>) {
    if (shift.start_time) {
      startTimesByShiftId.set(shift.id, shift.start_time);
    }
  }

  return {
    eventMarks: buildMarks(attendanceRows, (row) =>
      // Event date when resolvable, marking time as fallback.
      datesByEventId.get(row.event_id ?? "") ?? row.created_at,
    ),
    rehearsalMarks: buildMarks(rehearsalRows, (row) =>
      datesByEventId.get(row.event_id) ?? "",
    ),
    shiftMarks: buildMarks(workgroupRows, (row) => {
      if (row.shift_id === null) return "";
      return startTimesByShiftId.get(row.shift_id) ?? "";
    }),
  };
}

/** Maps rows to marks, dropping the ones without a resolvable date. */
function buildMarks<T extends { attended: boolean }>(
  rows: T[],
  resolveDate: (row: T) => string,
): ActivityMark[] {
  return rows.flatMap((row) => {
    const date = resolveDate(row);
    if (!date) return [];
    return [{ date, attended: row.attended }];
  });
}

/**
 * Average of the per-member shift-attendance rates of the caller's
 * workgroup, computed by the SECURITY DEFINER function so the group's
 * aggregate is visible without exposing any other member's rows.
 * Returns null when the caller has no workgroup or nobody in it has
 * marked shifts yet.
 */
export async function getMyWorkgroupShiftAverage(): Promise<number | null> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("my_workgroup_shift_average");

  if (error) {
    throw new Error(`Failed to fetch my workgroup shift average: ${error.message}`);
  }

  if (data === null || data === undefined) {
    return null;
  }

  // Postgres numeric can arrive as number or numeric-string depending on
  // the driver serialization; Number() normalizes both.
  return Number(data);
}
