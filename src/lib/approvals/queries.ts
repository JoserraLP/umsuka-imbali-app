import { createClient } from "@/lib/supabase/server";
import { isValidRole, DEFAULT_ROLE } from "@/lib/auth/roles";
import type { AppRole, ComponentType, UserStatus } from "@/types/database.types";

export interface PendingProfile {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  componentType: ComponentType;
  role: AppRole;
  status: UserStatus;
  createdAt: string;
}

/**
 * Lists all profiles with status = 'pending', ordered by
 * creation date (oldest first). Uses the regular client so
 * RLS applies — only active members (including admins) can
 * see these rows because the profiles SELECT policy allows
 * all profiles for is_active_member() = true.
 */
export async function listPendingProfiles(): Promise<PendingProfile[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, component_type, role, status, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(`Error al listar perfiles pendientes: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    email: null,
    componentType: row.component_type,
    role: isValidRole(row.role) ? row.role : DEFAULT_ROLE,
    status: row.status,
    createdAt: row.created_at,
  }));
}
