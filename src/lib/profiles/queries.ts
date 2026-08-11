import { createClient } from "@/lib/supabase/server";
import { isValidRole, DEFAULT_ROLE } from "@/lib/auth/roles";
import type { AppRole, ComponentType, UserStatus, AuthMethod, Workgroup } from "@/types/database.types";

export interface ProfileListItem {
  id: string;
  firstName: string;
  lastName: string;
  componentType: ComponentType;
  role: AppRole;
  isActive: boolean;
  status: UserStatus;
  username: string | null;
  authMethod: AuthMethod;
  createdAt: string;
}

export interface ProfileDetail extends ProfileListItem {
  birthDate: string | null;
  username: string | null;
  authMethod: AuthMethod;
  workgroup: Workgroup;
}

/**
 * Lists every member profile, ordered alphabetically. Relies on
 * umsuka.profiles' "select for any authenticated user" RLS policy — no
 * elevated client is used here. Callers that need to restrict this to
 * management roles must check that themselves before rendering.
 */
export async function listProfiles(): Promise<ProfileListItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, component_type, role, is_active, status, username, auth_method, created_at")
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
    role: isValidRole(row.role) ? row.role : DEFAULT_ROLE,
    isActive: row.is_active,
    status: row.status as UserStatus,
    username: row.username,
    authMethod: row.auth_method as AuthMethod,
    createdAt: row.created_at,
  }));
}

/**
 * Fetches a single profile by id, for the admin edit page. Returns null
 * if not found (relies on the same "select for any authenticated user"
 * RLS policy as listProfiles — callers must still gate on the caller's
 * own role before exposing this to a route).
 */
export async function getProfileById(userId: string): Promise<ProfileDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, birth_date, component_type, role, is_active, status, username, auth_method, created_at, workgroup")
    .eq("id", userId)
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
    createdAt: data.created_at,
  };
}
