import { createClient } from "@/lib/supabase/server";
import { isValidRole, DEFAULT_ROLE } from "@/lib/auth/roles";
import { AuthorizationError } from "@/lib/auth/permissions";
import { isLeadOfGroup, type MemberActor } from "@/lib/members/authorization";
import type { MemberListItem, MemberDetail } from "@/lib/members/schema";
import { getMyAssignedShifts, type MyAssignedShift } from "@/lib/shifts/assignments";
import { getUserAttendance, type UserAttendanceRecord } from "@/lib/attendance/queries";
import type {
  AppRole,
  AuthMethod,
  ComponentType,
  UserStatus,
  Workgroup,
} from "@/types/database.types";

/** Raw row shape of umsuka.profiles as projected by these queries. */
interface MemberRow {
  id: string;
  first_name: string;
  last_name: string;
  component_type: ComponentType;
  workgroup: Workgroup | null;
  role: string | null;
  is_active: boolean;
  status: UserStatus;
  username: string | null;
  auth_method: AuthMethod;
  created_at: string;
}

const MEMBER_LIST_COLUMNS =
  "id, first_name, last_name, component_type, workgroup, role, is_active, status, username, auth_method, created_at";

function mapMemberRow(row: MemberRow): MemberListItem {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    componentType: row.component_type,
    workgroup: row.workgroup ?? "ninguno",
    role: isValidRole(row.role) ? row.role : DEFAULT_ROLE,
    isActive: row.is_active,
    status: row.status,
    username: row.username,
    authMethod: row.auth_method,
    createdAt: row.created_at,
  };
}

/**
 * Lists every member profile for the management directory. Relies on the
 * umsuka.profiles "select for any active member" RLS policy (no elevated
 * client). Callers MUST gate on resolveMemberScope() before invoking.
 */
export async function getAllMembers(): Promise<MemberListItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(MEMBER_LIST_COLUMNS)
    .order("first_name", { ascending: true })
    .order("last_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list members: ${error.message}`);
  }

  return (data ?? []).map(mapMemberRow);
}

/**
 * Lists only the members of a given workgroup — for workgroup leads.
 * THROWS AuthorizationError unless the actor is the lead of that exact
 * group (defense in depth: the requested workgroup is never trusted on
 * its own, it must match the actor's own group).
 */
export async function getWorkgroupMembers(
  actor: MemberActor,
  workgroup: Workgroup,
): Promise<MemberListItem[]> {
  if (!isLeadOfGroup(actor, workgroup)) {
    throw new AuthorizationError();
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select(MEMBER_LIST_COLUMNS)
    .eq("workgroup", workgroup)
    .order("first_name", { ascending: true })
    .order("last_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list members of workgroup ${workgroup}: ${error.message}`);
  }

  return (data ?? []).map(mapMemberRow);
}

/**
 * Fetches a single member profile including birth_date. Returns null when
 * the id does not exist. Callers must still validate the viewer's access
 * with canViewMemberDetail() before rendering.
 */
export async function getMemberDetail(userId: string): Promise<MemberDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, birth_date, component_type, workgroup, role, is_active, status, username, auth_method, created_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch member ${userId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    ...mapMemberRow(data),
    birthDate: data.birth_date,
  };
}

export interface MemberHistory {
  member: MemberDetail;
  shifts: MyAssignedShift[];
  attendance: UserAttendanceRecord[];
}

/**
 * Member profile + assigned shifts + attendance history, reusing the
 * queries from previous sprints. Returns null when the profile does not
 * exist. Callers must gate access with canViewMemberDetail(); the RLS
 * policies added in migration 0043 let a lead read shifts/attendance of
 * members of their own workgroup, and management reads everything.
 */
export async function getMemberDetailWithHistory(userId: string): Promise<MemberHistory | null> {
  const member = await getMemberDetail(userId);

  if (!member) {
    return null;
  }

  const [shifts, attendance] = await Promise.all([
    getMyAssignedShifts(userId),
    getUserAttendance(userId),
  ]);

  return { member, shifts, attendance };
}
