import { createClient } from "@/lib/supabase/server";
import { isValidRole, DEFAULT_ROLE } from "@/lib/auth/roles";
import { ensureProfileExists } from "@/lib/profiles/provisioning";
import type { AuthenticatedProfile } from "@/types/auth";

/**
 * Returns the current authenticated user's session profile, joining
 * Supabase Auth identity data with the umsuka.profiles row. Returns
 * `null` when there is no active session — callers decide whether to
 * redirect (page-level) or throw (server actions / route handlers).
 *
 * This never trusts client input for authorization: role always comes
 * from the database row, never from the JWT's user metadata.
 */
export async function getCurrentProfile(): Promise<AuthenticatedProfile | null> {
  const supabase = await createClient();

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    if (userError) {
      console.error(
        "getCurrentProfile: supabase.auth.getUser() falló:",
        { message: userError.message, status: userError.status },
      );
    }
    return null;
  }

  const profile = await fetchProfileRow(user.id);

  if (profile) {
    if (!profile.is_active) {
      console.error(
        `getCurrentProfile: el perfil ${user.id} está desactivado (is_active=false) — ` +
          "tratado como no autenticado.",
      );
      return null;
    }

    // NEW: check status — pending/suspended users cannot access the app
    if (profile.status !== "active") {
      console.error(
        `getCurrentProfile: el perfil ${user.id} tiene status "${profile.status}" — ` +
          "tratado como no autenticado.",
      );
      return null;
    }

    return buildAuthenticatedProfile(profile, user);
  }

  // No profile row yet — this should only happen for users created
  // before umsuka.handle_new_user() was installed. Self-heal once
  // instead of bouncing the user back to login indefinitely.
  console.error(
    "getCurrentProfile: no se encontró fila en umsuka.profiles para el usuario autenticado " +
      `(userId: ${user.id}). Intentando crearla automáticamente...`,
  );

  const provisionResult = await ensureProfileExists(user);
  if (!provisionResult.success) {
    console.error("getCurrentProfile: la auto-provisión del perfil falló:", provisionResult.error);
    return null;
  }

  const retriedProfile = await fetchProfileRow(user.id);
  if (!retriedProfile) {
    console.error(
      "getCurrentProfile: la fila se creó pero no se pudo releer inmediatamente después.",
    );
    return null;
  }

  return buildAuthenticatedProfile(retriedProfile, user);
}

async function fetchProfileRow(userId: string) {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, birth_date, component_type, role, workgroup, is_workgroup_lead, is_active, status, username, auth_method, created_at")
    .eq("id", userId)
    .maybeSingle();

  if (error) {
    console.error("getCurrentProfile: error al consultar umsuka.profiles:", {
      message: error.message,
      code: error.code,
      details: error.details,
    });
    return null;
  }

  return data;
}

function buildAuthenticatedProfile(
  profile: NonNullable<Awaited<ReturnType<typeof fetchProfileRow>>>,
  user: { email?: string | null; user_metadata?: Record<string, unknown> },
): AuthenticatedProfile {
  const role = isValidRole(profile.role) ? profile.role : DEFAULT_ROLE;

  return {
    id: profile.id,
    firstName: profile.first_name,
    lastName: profile.last_name,
    // Never expose the internal email alias (user-{uuid}@umsuka.internal)
    // to any user, not even the account owner themselves.
    email: profile.auth_method === "email_alias" ? null : (user.email ?? null),
    avatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    role,
    componentType: profile.component_type,
    workgroup: profile.workgroup ?? "ninguno",
    isWorkgroupLead: profile.is_workgroup_lead ?? false,
    birthDate: profile.birth_date,
    isActive: profile.is_active,
    status: profile.status,
    username: profile.username ?? null,
    authMethod: profile.auth_method,
    createdAt: profile.created_at,
  };
}

export async function requireAuthenticatedProfile(): Promise<AuthenticatedProfile> {
  const profile = await getCurrentProfile();
  if (!profile) {
    throw new Error("Se requiere autenticación.");
  }
  return profile;
}
