import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import type { AuthenticatedProfile } from "@/types/auth";
import {
  createGuardianSchema,
  updateGuardianSchema,
  assignGuardianSchema,
  unassignGuardianSchema,
  setMinorStatusSchema,
  type CreateGuardianInput,
  type UpdateGuardianInput,
  type AssignGuardianInput,
  type UnassignGuardianInput,
  type SetMinorStatusInput,
} from "@/lib/guardians/schema";

export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
}

const GUARDIAN_GUARD_MESSAGE = "Solo la directiva puede gestionar representantes.";

async function requireManagementGuard(errorMessage: string): Promise<AuthenticatedProfile | MutationResult> {
  const actor = await requireAuthenticatedProfile();

  if (!isManagementRole(actor.role)) {
    return { success: false, error: errorMessage };
  }

  return actor;
}

function parseError(errors: { issues: { message: string }[] }): MutationResult {
  return {
    success: false,
    error: errors.issues.map((issue) => issue.message).join(", "),
  };
}

// ── Mutations ─────────────────────────────────────

export async function createGuardian(input: CreateGuardianInput): Promise<MutationResult> {
  const parsed = createGuardianSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard(GUARDIAN_GUARD_MESSAGE);
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  // If is_member, verify target member exists and is assignable
  if (parsed.data.is_member && parsed.data.member_user_id) {
    const { data: member, error: memberError } = await supabase
      .from("profiles")
      .select("id, is_active, status, deleted_at, is_minor")
      .eq("id", parsed.data.member_user_id)
      .maybeSingle();

    if (memberError) {
      return { success: false, error: memberError.message };
    }

    if (!member || !member.is_active || member.status !== "active" || member.deleted_at !== null) {
      return { success: false, error: "El miembro seleccionado ya no está disponible." };
    }

    if (member.is_minor) {
      return { success: false, error: "Un menor no puede ser representante." };
    }
  }

  const { data, error } = await supabase
    .from("legal_guardians")
    .insert({
      full_name: parsed.data.full_name,
      document_id: parsed.data.document_id ?? null,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      relationship: parsed.data.relationship ?? null,
      is_member: parsed.data.is_member,
      member_user_id: parsed.data.member_user_id ?? null,
      created_by: authResult.id,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true, id: data.id };
}

export async function updateGuardian(input: UpdateGuardianInput): Promise<MutationResult> {
  const parsed = updateGuardianSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard(GUARDIAN_GUARD_MESSAGE);
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const { data: existing, error: fetchError } = await supabase
    .from("legal_guardians")
    .select("id")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (fetchError) {
    return { success: false, error: fetchError.message };
  }

  if (!existing) {
    return { success: false, error: "Representante no encontrado." };
  }

  if (parsed.data.is_member && parsed.data.member_user_id) {
    const { data: member, error: memberError } = await supabase
      .from("profiles")
      .select("id, is_active, status, deleted_at, is_minor")
      .eq("id", parsed.data.member_user_id)
      .maybeSingle();

    if (memberError) {
      return { success: false, error: memberError.message };
    }

    if (!member || !member.is_active || member.status !== "active" || member.deleted_at !== null) {
      return { success: false, error: "El miembro seleccionado ya no está disponible." };
    }

    if (member.is_minor) {
      return { success: false, error: "Un menor no puede ser representante." };
    }
  }

  const { error } = await supabase
    .from("legal_guardians")
    .update({
      full_name: parsed.data.full_name,
      document_id: parsed.data.document_id ?? null,
      email: parsed.data.email ?? null,
      phone: parsed.data.phone ?? null,
      relationship: parsed.data.relationship ?? null,
      is_member: parsed.data.is_member,
      member_user_id: parsed.data.member_user_id ?? null,
    })
    .eq("id", parsed.data.id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function assignGuardian(input: AssignGuardianInput): Promise<MutationResult> {
  const parsed = assignGuardianSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard(GUARDIAN_GUARD_MESSAGE);
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const { data: minor, error: minorError } = await supabase
    .from("profiles")
    .select("id, is_minor, deleted_at")
    .eq("id", parsed.data.minor_id)
    .maybeSingle();

  if (minorError) {
    return { success: false, error: minorError.message };
  }

  if (!minor) {
    return { success: false, error: "Menor no encontrado." };
  }

  if (!minor.is_minor) {
    return { success: false, error: "El perfil no está marcado como menor." };
  }

  if (minor.deleted_at !== null) {
    return { success: false, error: "El perfil del menor no está disponible." };
  }

  const { data: guardian, error: guardianError } = await supabase
    .from("legal_guardians")
    .select("id")
    .eq("id", parsed.data.guardian_id)
    .maybeSingle();

  if (guardianError) {
    return { success: false, error: guardianError.message };
  }

  if (!guardian) {
    return { success: false, error: "Representante no encontrado." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ legal_guardian_id: parsed.data.guardian_id })
    .eq("id", parsed.data.minor_id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function unassignGuardian(input: UnassignGuardianInput): Promise<MutationResult> {
  const parsed = unassignGuardianSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard(GUARDIAN_GUARD_MESSAGE);
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const { data: minor, error: minorError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", parsed.data.minor_id)
    .maybeSingle();

  if (minorError) {
    return { success: false, error: minorError.message };
  }

  if (!minor) {
    return { success: false, error: "Menor no encontrado." };
  }

  const { error } = await supabase
    .from("profiles")
    .update({ legal_guardian_id: null })
    .eq("id", parsed.data.minor_id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

export async function setMinorStatus(input: SetMinorStatusInput): Promise<MutationResult> {
  const parsed = setMinorStatusSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard(GUARDIAN_GUARD_MESSAGE);
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const { data: profile, error: fetchError } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", parsed.data.user_id)
    .maybeSingle();

  if (fetchError) {
    return { success: false, error: fetchError.message };
  }

  if (!profile) {
    return { success: false, error: "Perfil no encontrado." };
  }

  let guardianId: string | null = null;

  if (parsed.data.is_minor) {
    // If is_minor true and guardian provided, validate it exists
    if (parsed.data.legal_guardian_id) {
      const { data: guardian, error: guardianError } = await supabase
        .from("legal_guardians")
        .select("id")
        .eq("id", parsed.data.legal_guardian_id)
        .maybeSingle();

      if (guardianError) {
        return { success: false, error: guardianError.message };
      }

      if (!guardian) {
        return { success: false, error: "Representante no encontrado." };
      }

      guardianId = parsed.data.legal_guardian_id;
    } else {
      // Keep existing? For explicit set, set to null if not provided — caller decides.
      // If no guardian provided, clear it (progressive flow allows minor without guardian initially).
      guardianId = null;
    }
  } else {
    // Not minor -> always clear guardian
    guardianId = null;
  }

  const { error } = await supabase
    .from("profiles")
    .update({ is_minor: parsed.data.is_minor, legal_guardian_id: guardianId })
    .eq("id", parsed.data.user_id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}
