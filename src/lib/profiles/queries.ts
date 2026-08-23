import { createClient } from "@/lib/supabase/server";
import { isValidRole, DEFAULT_ROLE } from "@/lib/auth/roles";
import type { AppRole, ComponentType, UserStatus, AuthMethod, Workgroup } from "@/types/database.types";

/**
 * One row of the member directory. Deliberately excludes private
 * contact data (profile photo, bio, phone): with the column-agnostic
 * "select for any authenticated user" RLS policy, anything selected here
 * is readable by every active member through the API, so the list keeps
 * the smallest projection that the directory UIs need (least privilege).
 * Contact fields only live on ProfileDetail (management-gated pages).
 */
export interface ProfileListItem {
  id: string;
  firstName: string;
  lastName: string;
  componentType: ComponentType;
  workgroup: Workgroup;
  role: AppRole;
  isActive: boolean;
  status: UserStatus;
  username: string | null;
  authMethod: AuthMethod;
  /** "music" / "dance" when the member is the responsible of that component. */
  componentLeadFor: string | null;
  skills: string[];
  joinedAt: string | null;
  createdAt: string;
}

export interface ProfileDetail extends ProfileListItem {
  birthDate: string | null;
  username: string | null;
  authMethod: AuthMethod;
  avatarUrl: string | null;
  bio: string | null;
  phone: string | null;
}

/**
 * Count-based summary of a member's participation history, used by the
 * /profile header tiles. One count-only query per table, run in
 * parallel; every query is scoped by user_id.
 */
export interface ProfileHistorySummary {
  /** event_registrations: events the member has signed up to. */
  events: number;
  /** attendance rows with attended = true. */
  attendancePresent: number;
  /** attendance rows with attended = false ("faltas sin asistir"). */
  attendanceAbsent: number;
  /** absences rows (requested absences). */
  absences: number;
  /** shift_assignments rows (shifts the member is assigned to). */
  shifts: number;
  /**
   * rehearsal_attendance rows with attended = true, across all sessions
   * (Sprint 27). A rehearsal counts once per enabled session.
   */
  rehearsalsAttended: number;
  /**
   * Total rehearsal_attendance rows for the member (marked sessions,
   * present or absent) — the denominator of the participation ratio.
   */
  rehearsalsMarked: number;
}

/**
 * Lists every member profile, ordered alphabetically. Relies on
 * umsuka.profiles' "select for any authenticated user" RLS policy — no
 * elevated client is used here, so the projection is deliberately
 * contact-free (no avatar_url / bio / phone — see ProfileListItem).
 * Callers that need to restrict this to management roles must check
 * that themselves before rendering.
 */
export async function listProfiles(): Promise<ProfileListItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, component_type, workgroup, role, is_active, status, username, auth_method, component_lead_for, skills, joined_at, created_at")
    .is("deleted_at", null)
    .order("first_name", { ascending: true })
    .order("last_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list profiles: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    componentType: row.component_type as ComponentType,
    workgroup: row.workgroup ?? "ninguno",
    role: isValidRole(row.role) ? row.role : DEFAULT_ROLE,
    isActive: row.is_active,
    status: row.status as UserStatus,
    username: row.username,
    authMethod: row.auth_method as AuthMethod,
    componentLeadFor: (row.component_lead_for as string | null) ?? null,
    skills: row.skills ?? [],
    joinedAt: row.joined_at,
    createdAt: row.created_at,
  }));
}

/**
 * Fetches a single profile by id, for the admin edit page. Returns null
 * if not found (relies on the same "select for any authenticated user"
 * RLS policy as listProfiles — callers must still gate on the caller's
 * own role before exposing this to a route).
 *
 * SECURITY: this projection includes private contact data (avatar_url,
 * bio, phone). It must only be exposed to management users or to the
 * member themselves; current call sites are already gated by role
 * (admin edit pages) or by session (own profile via getCurrentProfile).
 */
export async function getProfileById(userId: string): Promise<ProfileDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, birth_date, component_type, role, is_active, status, username, auth_method, avatar_url, bio, phone, skills, joined_at, created_at, workgroup, component_lead_for")
    .eq("id", userId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to fetch profile ${userId}: ${error.message}`);
  }

  if (!data) {
    return null;
  }

  return {
    id: data.id,
    firstName: data.first_name,
    lastName: data.last_name,
    birthDate: data.birth_date,
    componentType: data.component_type as ComponentType,
    role: isValidRole(data.role) ? data.role : DEFAULT_ROLE,
    isActive: data.is_active,
    status: data.status as UserStatus,
    username: data.username,
    authMethod: data.auth_method as AuthMethod,
    workgroup: data.workgroup ?? "ninguno",
    componentLeadFor: (data.component_lead_for as string | null) ?? null,
    avatarUrl: data.avatar_url,
    bio: data.bio,
    phone: data.phone,
    skills: data.skills ?? [],
    joinedAt: data.joined_at,
    createdAt: data.created_at,
  };
}

/**
 * Returns the count-based participation summary for a member: events
 * registered, attendance (present / absent), absences, shifts and
 * rehearsal sessions (attended / marked). Runs seven head-only count
 * queries in parallel, each scoped to the user.
 */
export async function getProfileHistorySummary(
  userId: string,
): Promise<ProfileHistorySummary> {
  const supabase = await createClient();

  const [
    registrations,
    attendancePresent,
    attendanceAbsent,
    absences,
    shiftAssignments,
    rehearsalsAttended,
    rehearsalsMarked,
  ] = await Promise.all([
      supabase
        .from("event_registrations")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("attendance")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("attended", true),
      supabase
        .from("attendance")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("attended", false),
      supabase
        .from("absences")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("shift_assignments")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId),
      supabase
        .from("rehearsal_attendance")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId)
        .eq("attended", true),
      supabase
        .from("rehearsal_attendance")
        .select("*", { count: "exact", head: true })
        .eq("user_id", userId),
    ]);

  const labeled = [
    ["event_registrations", registrations],
    ["attendance (attended)", attendancePresent],
    ["attendance (not attended)", attendanceAbsent],
    ["absences", absences],
    ["shift_assignments", shiftAssignments],
    ["rehearsal_attendance (attended)", rehearsalsAttended],
    ["rehearsal_attendance (marked)", rehearsalsMarked],
  ] as const;

  for (const [label, result] of labeled) {
    if (result.error) {
      throw new Error(
        `Failed to fetch ${label} count for user ${userId}: ${result.error.message}`,
      );
    }
  }

  return {
    events: registrations.count ?? 0,
    attendancePresent: attendancePresent.count ?? 0,
    attendanceAbsent: attendanceAbsent.count ?? 0,
    absences: absences.count ?? 0,
    shifts: shiftAssignments.count ?? 0,
    rehearsalsAttended: rehearsalsAttended.count ?? 0,
    rehearsalsMarked: rehearsalsMarked.count ?? 0,
  };
}
