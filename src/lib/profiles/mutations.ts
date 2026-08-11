import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { canAssignRole, requireAdmin, AuthorizationError } from "@/lib/auth/permissions";
import {
  updateOwnProfileSchema,
  updateMemberRoleSchema,
  updateMemberProfileSchema,
  setMemberActiveSchema,
  setMemberComponentTypeSchema,
  type UpdateOwnProfileInput,
  type UpdateMemberRoleInput,
  type UpdateMemberProfileInput,
  type SetMemberActiveInput,
  type SetMemberComponentTypeInput,
} from "@/lib/profiles/schema";
import type { AppRole, ComponentType, Workgroup } from "@/types/database.types";

export interface MutationResult {
  success: boolean;
  error?: string;
}

/**
 * Music and dance members must belong to a workgroup (mirrors the
 * profiles_component_type_requires_workgroup DB constraint). A member
 * profile only belongs to "ninguno" when no workgroup was ever assigned.
 */
export function componentTypeRequiresWorkgroup(componentType: ComponentType): boolean {
  return componentType === "music" || componentType === "dance";
}

function canSetComponentType(
  componentType: ComponentType,
  currentWorkgroup: Workgroup | null,
): boolean {
  if (!componentTypeRequiresWorkgroup(componentType)) return true;
  return currentWorkgroup !== null && currentWorkgroup !== "ninguno";
}

/**
 * Updates the caller's own profile fields. `role` can never be changed
 * through this path — see updateMemberRole for that, which is gated by
 * requireAdmin() + canAssignRole().
 */
export async function updateOwnProfile(input: UpdateOwnProfileInput): Promise<MutationResult> {
  const parsed = updateOwnProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const profile = await requireAuthenticatedProfile();
  const supabase = await createClient();

  if (!canSetComponentType(parsed.data.componentType, profile.workgroup)) {
    return {
      success: false,
      error:
        "Música y baile requieren un grupo de trabajo obligatoriamente. Contacta a un administrador para que te asigne uno.",
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      birth_date: parsed.data.birthDate,
      component_type: parsed.data.componentType,
    })
    .eq("id", profile.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Changes another member's role. Only callable by admin/super_admin
 * (requireAdmin), and further restricted by canAssignRole() so that a
 * plain admin cannot grant/revoke super_admin or admin themselves.
 */
export async function updateMemberRole(input: UpdateMemberRoleInput): Promise<MutationResult> {
  const parsed = updateMemberRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();

  try {
    requireAdmin(actor.role);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  const targetRole = parsed.data.role as AppRole;

  if (!canAssignRole(actor.role, targetRole)) {
    return {
      success: false,
      error: "Only a super_admin can grant or revoke the super_admin/admin roles.",
    };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ role: targetRole })
    .eq("id", parsed.data.userId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Admin-only: edits the personal fields of ANY member's profile (name,
 * birth date, component type). Never touches role or is_active — those
 * have their own dedicated, more tightly-scoped mutations below/above.
 */
export async function updateMemberProfile(input: UpdateMemberProfileInput): Promise<MutationResult> {
  const parsed = updateMemberProfileSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();

  try {
    requireAdmin(actor.role);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  const supabase = await createClient();
  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("workgroup")
    .eq("id", parsed.data.userId)
    .maybeSingle();

  if (
    targetProfile &&
    !canSetComponentType(parsed.data.componentType, targetProfile.workgroup as Workgroup | null)
  ) {
    return {
      success: false,
      error:
        "Música y baile requieren un grupo de trabajo obligatoriamente. Asigna un grupo de trabajo antes de cambiar el componente.",
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({
      first_name: parsed.data.firstName,
      last_name: parsed.data.lastName,
      birth_date: parsed.data.birthDate,
      component_type: parsed.data.componentType,
    })
    .eq("id", parsed.data.userId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Admin-only: activates ("alta") or deactivates ("baja") a member.
 * Deactivation is a soft flag (umsuka.profiles.is_active), not a delete
 * — it must never cascade-delete history from future modules (events,
 * attendance, votes, etc.). An actor can never deactivate themselves,
 * to avoid an admin locking themselves out of the panel.
 */
export async function setMemberActive(input: SetMemberActiveInput): Promise<MutationResult> {
  const parsed = setMemberActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();

  try {
    requireAdmin(actor.role);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  if (parsed.data.userId === actor.id && !parsed.data.isActive) {
    return { success: false, error: "You cannot deactivate your own account." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("profiles")
    .update({ is_active: parsed.data.isActive })
    .eq("id", parsed.data.userId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Admin-only: changes a member's component type from the directory table.
 * Only touches component_type — name, role, and status keep their own
 * dedicated mutations.
 */
export async function updateMemberComponentType(
  input: SetMemberComponentTypeInput,
): Promise<MutationResult> {
  const parsed = setMemberComponentTypeSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();

  try {
    requireAdmin(actor.role);
  } catch (err) {
    if (err instanceof AuthorizationError) {
      return { success: false, error: err.message };
    }
    throw err;
  }

  const supabase = await createClient();
  const { data: targetProfile } = await supabase
    .from("profiles")
    .select("workgroup")
    .eq("id", parsed.data.userId)
    .maybeSingle();

  if (
    targetProfile &&
    !canSetComponentType(parsed.data.componentType, targetProfile.workgroup as Workgroup | null)
  ) {
    return {
      success: false,
      error:
        "Música y baile requieren un grupo de trabajo obligatoriamente. Asigna un grupo de trabajo antes de cambiar el componente.",
    };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ component_type: parsed.data.componentType })
    .eq("id", parsed.data.userId);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
