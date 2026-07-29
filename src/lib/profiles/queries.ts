import { createClient } from "@/lib/supabase/server";
import { isValidRole, DEFAULT_ROLE } from "@/lib/auth/roles";
import type { AppRole, ComponentType, UserStatus } from "@/types/database.types";

export interface ProfileListItem {
  id: string;
  firstName: string;
  lastName: string;
  componentType: ComponentType;
  role: AppRole;
  isActive: boolean;
  status: UserStatus;
  createdAt: string;
}

export interface ProfileDetail extends ProfileListItem {
  birthDate: string | null;
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
    .select("id, first_name, last_name, component_type, role, is_active, status, created_at")
    .order("first_name", { ascending: true })
    .order("last_name", { ascending: true });

  if (error) {
    throw new Error(`Failed to list profiles: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    componentType: row.component_type,
    role: isValidRole(row.role) ? row.role : DEFAULT_ROLE,
    isActive: row.is_active,
    status: row.status,
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
    .select("id, first_name, last_name, birth_date, component_type, role, is_active, status, created_at")
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
    componentType: data.component_type,
    role: isValidRole(data.role) ? data.role : DEFAULT_ROLE,
    isActive: data.is_active,
    status: data.status,
    createdAt: data.created_at,
  };
}
