import { createClient } from "@/lib/supabase/server";

// ── Types ─────────────────────────────────────────

export interface GuardianRow {
  id: string;
  fullName: string;
  documentId: string | null;
  email: string | null;
  phone: string | null;
  relationship: string | null;
  isMember: boolean;
  memberUserId: string | null;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface MinorProfileRow {
  id: string;
  firstName: string;
  lastName: string;
  isMinor: boolean;
  legalGuardianId: string | null;
  isActive: boolean;
  status: string;
  deletedAt: string | null;
}

export interface MinorWithGuardian {
  profile: MinorProfileRow;
  guardian: GuardianRow | null;
}

// ── Helpers ───────────────────────────────────────

function mapGuardian(row: {
  id: string;
  full_name: string;
  document_id: string | null;
  email: string | null;
  phone: string | null;
  relationship: string | null;
  is_member: boolean;
  member_user_id: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}): GuardianRow {
  return {
    id: row.id,
    fullName: row.full_name,
    documentId: row.document_id ?? null,
    email: row.email ?? null,
    phone: row.phone ?? null,
    relationship: row.relationship ?? null,
    isMember: row.is_member,
    memberUserId: row.member_user_id ?? null,
    createdBy: row.created_by ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapMinorProfile(row: {
  id: string;
  first_name: string;
  last_name: string;
  is_minor: boolean;
  legal_guardian_id: string | null;
  is_active: boolean;
  status: string;
  deleted_at: string | null;
}): MinorProfileRow {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    isMinor: row.is_minor,
    legalGuardianId: row.legal_guardian_id ?? null,
    isActive: row.is_active,
    status: row.status,
    deletedAt: row.deleted_at ?? null,
  };
}

// ── Queries ───────────────────────────────────────

export async function getGuardians(): Promise<GuardianRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("legal_guardians")
    .select(
      "id, full_name, document_id, email, phone, relationship, is_member, member_user_id, created_by, created_at, updated_at",
    )
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Error al obtener representantes: ${error.message}`);
  }

  return (data ?? []).map((row) =>
    mapGuardian(
      row as {
        id: string;
        full_name: string;
        document_id: string | null;
        email: string | null;
        phone: string | null;
        relationship: string | null;
        is_member: boolean;
        member_user_id: string | null;
        created_by: string | null;
        created_at: string;
        updated_at: string;
      },
    ),
  );
}

export async function getGuardianById(id: string): Promise<GuardianRow | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("legal_guardians")
    .select(
      "id, full_name, document_id, email, phone, relationship, is_member, member_user_id, created_by, created_at, updated_at",
    )
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al obtener el representante: ${error.message}`);
  }

  if (!data) return null;

  return mapGuardian(
    data as {
      id: string;
      full_name: string;
      document_id: string | null;
      email: string | null;
      phone: string | null;
      relationship: string | null;
      is_member: boolean;
      member_user_id: string | null;
      created_by: string | null;
      created_at: string;
      updated_at: string;
    },
  );
}

/**
 * Returns minors assigned to a guardian who is a member (member_user_id).
 * First fetches guardian ids for the member, then profiles where
 * legal_guardian_id in those ids and is_minor=true.
 */
export async function getMinorsByGuardian(memberUserId: string): Promise<MinorProfileRow[]> {
  const supabase = await createClient();

  const { data: guardians, error: guardianError } = await supabase
    .from("legal_guardians")
    .select("id")
    .eq("member_user_id", memberUserId);

  if (guardianError) {
    throw new Error(`Error al obtener menores del representante: ${guardianError.message}`);
  }

  const guardianIds = (guardians ?? []).map((g) => (g as { id: string }).id);
  if (guardianIds.length === 0) return [];

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, is_minor, legal_guardian_id, is_active, status, deleted_at")
    .in("legal_guardian_id", guardianIds)
    .eq("is_minor", true)
    .is("deleted_at", null);

  if (error) {
    throw new Error(`Error al obtener menores: ${error.message}`);
  }

  return (data ?? []).map((row) =>
    mapMinorProfile(
      row as {
        id: string;
        first_name: string;
        last_name: string;
        is_minor: boolean;
        legal_guardian_id: string | null;
        is_active: boolean;
        status: string;
        deleted_at: string | null;
      },
    ),
  );
}

export async function getMinorWithGuardian(minorId: string): Promise<MinorWithGuardian | null> {
  const supabase = await createClient();

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, is_minor, legal_guardian_id, is_active, status, deleted_at")
    .eq("id", minorId)
    .maybeSingle();

  if (profileError) {
    throw new Error(`Error al obtener el menor: ${profileError.message}`);
  }

  if (!profile) return null;

  const mappedProfile = mapMinorProfile(
    profile as {
      id: string;
      first_name: string;
      last_name: string;
      is_minor: boolean;
      legal_guardian_id: string | null;
      is_active: boolean;
      status: string;
      deleted_at: string | null;
    },
  );

  if (!mappedProfile.legalGuardianId) {
    return { profile: mappedProfile, guardian: null };
  }

  const { data: guardian, error: guardianError } = await supabase
    .from("legal_guardians")
    .select(
      "id, full_name, document_id, email, phone, relationship, is_member, member_user_id, created_by, created_at, updated_at",
    )
    .eq("id", mappedProfile.legalGuardianId)
    .maybeSingle();

  if (guardianError) {
    throw new Error(`Error al obtener el representante del menor: ${guardianError.message}`);
  }

  const mappedGuardian = guardian
    ? mapGuardian(
        guardian as {
          id: string;
          full_name: string;
          document_id: string | null;
          email: string | null;
          phone: string | null;
          relationship: string | null;
          is_member: boolean;
          member_user_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        },
      )
    : null;

  return { profile: mappedProfile, guardian: mappedGuardian };
}

/**
 * Returns active, non-minor members available to be selected as guardian.
 * Mirrors instruments' getAssignableMembers criteria.
 */
export async function getAvailableMembersForGuardian(): Promise<MinorProfileRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, is_minor, legal_guardian_id, is_active, status, deleted_at")
    .eq("is_minor", false)
    .eq("is_active", true)
    .eq("status", "active")
    .is("deleted_at", null)
    .order("first_name", { ascending: true });

  if (error) {
    throw new Error(`Error al obtener miembros disponibles: ${error.message}`);
  }

  return (data ?? []).map((row) =>
    mapMinorProfile(
      row as {
        id: string;
        first_name: string;
        last_name: string;
        is_minor: boolean;
        legal_guardian_id: string | null;
        is_active: boolean;
        status: string;
        deleted_at: string | null;
      },
    ),
  );
}

/**
 * Returns all minors with their guardian (left join) — useful for admin listing.
 */
export async function getMinorsWithGuardians(): Promise<MinorWithGuardian[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("profiles")
    .select("id, first_name, last_name, is_minor, legal_guardian_id, is_active, status, deleted_at")
    .eq("is_minor", true)
    .is("deleted_at", null)
    .order("first_name", { ascending: true });

  if (error) {
    throw new Error(`Error al obtener menores: ${error.message}`);
  }

  const profiles = (data ?? []).map((row) =>
    mapMinorProfile(
      row as {
        id: string;
        first_name: string;
        last_name: string;
        is_minor: boolean;
        legal_guardian_id: string | null;
        is_active: boolean;
        status: string;
        deleted_at: string | null;
      },
    ),
  );

  if (profiles.length === 0) return [];

  const guardianIds = [...new Set(profiles.map((p) => p.legalGuardianId).filter(Boolean) as string[])];
  if (guardianIds.length === 0) {
    return profiles.map((profile) => ({ profile, guardian: null }));
  }

  const { data: guardians, error: guardianError } = await supabase
    .from("legal_guardians")
    .select(
      "id, full_name, document_id, email, phone, relationship, is_member, member_user_id, created_by, created_at, updated_at",
    )
    .in("id", guardianIds);

  if (guardianError) {
    throw new Error(`Error al obtener representantes: ${guardianError.message}`);
  }

  const byId = new Map(
    (guardians ?? []).map((g) => [
      (g as { id: string }).id,
      mapGuardian(
        g as {
          id: string;
          full_name: string;
          document_id: string | null;
          email: string | null;
          phone: string | null;
          relationship: string | null;
          is_member: boolean;
          member_user_id: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
        },
      ),
    ]),
  );

  return profiles.map((profile) => ({
    profile,
    guardian: profile.legalGuardianId ? (byId.get(profile.legalGuardianId) ?? null) : null,
  }));
}
