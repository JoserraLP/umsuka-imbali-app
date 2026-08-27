import "server-only";

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import type { AuthenticatedProfile } from "@/types/auth";
import {
  createFormationSchema,
  assignDancerSchema,
  removeDancerSchema,
  moveDancerSchema,
  assignInstrumentSchema,
  unassignInstrumentSchema,
} from "@/lib/formation/schema";
import type {
  CreateFormationInput,
  AssignDancerInput,
  RemoveDancerInput,
  MoveDancerInput,
  AssignInstrumentInput,
  UnassignInstrumentInput,
} from "@/lib/formation/schema";

export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
}

const UNIQUE_VIOLATION = "23505";
const FOREIGN_KEY_VIOLATION = "23503";

// ── Authorization helpers ─────────────────────────────

async function requireManagementGuard(
  errorMessage = "Solo la directiva puede gestionar formaciones.",
): Promise<AuthenticatedProfile | MutationResult> {
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

// ── Mutations ─────────────────────────────────────────

export async function createFormation(input: CreateFormationInput): Promise<MutationResult> {
  const parsed = createFormationSchema.safeParse(input);
  if (!parsed.success) return parseError(parsed.error);

  const authResult = await requireManagementGuard();
  if (!("id" in authResult)) return authResult;

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("dance_formations")
    .insert({
      name: parsed.data.name,
      event_id: parsed.data.eventId ?? null,
      created_by: authResult.id,
      formation_type: parsed.data.formationType,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return { success: false, error: "El evento asociado no existe." };
    }
    if (error.code === UNIQUE_VIOLATION) {
      return { success: false, error: "Ya existe una formación con ese nombre." };
    }
    return { success: false, error: error.message };
  }

  return { success: true, id: data.id };
}

export async function assignDancerToSeat(input: AssignDancerInput): Promise<MutationResult> {
  const parsed = assignDancerSchema.safeParse(input);
  if (!parsed.success) return parseError(parsed.error);

  const authResult = await requireManagementGuard();
  if (!("id" in authResult)) return authResult;

  const supabase = await createClient();

  // Validate formation is dance type
  const { data: formation, error: formationError } = await supabase
    .from("dance_formations")
    .select("formation_type")
    .eq("id", parsed.data.formationId)
    .maybeSingle();
  if (formationError) return { success: false, error: formationError.message };
  if (!formation) return { success: false, error: "Formación no encontrada." };
  if ((formation.formation_type as string) !== "dance") {
    return { success: false, error: "Esta formación es de música; no se pueden asignar bailarinas." };
  }

  // Validate component_type = dance
  const { data: member, error: memberError } = await supabase
    .from("profiles")
    .select("id, component_type, is_active, status, deleted_at")
    .eq("id", parsed.data.memberId)
    .maybeSingle();

  if (memberError) return { success: false, error: memberError.message };
  if (!member) return { success: false, error: "Bailarina no encontrada." };
  if (member.component_type !== "dance") {
    return { success: false, error: "Solo bailarinas del grupo de baile pueden asignarse a asientos." };
  }
  if (!member.is_active || member.status !== "active" || member.deleted_at !== null) {
    return { success: false, error: "La bailarina seleccionada ya no está disponible." };
  }

  // Check member already assigned elsewhere in this formation
  const { data: existingMember, error: existingMemberError } = await supabase
    .from("dance_positions")
    .select("id")
    .eq("formation_id", parsed.data.formationId)
    .eq("member_id", parsed.data.memberId)
    .maybeSingle();

  if (existingMemberError) return { success: false, error: existingMemberError.message };
  if (existingMember) {
    return { success: false, error: "La bailarina ya está asignada a otro asiento en esta formación." };
  }

  // Check if seat is already occupied
  const { data: seatOccupied, error: seatError } = await supabase
    .from("dance_positions")
    .select("id, member_id")
    .eq("formation_id", parsed.data.formationId)
    .eq("row_number", parsed.data.rowNumber)
    .eq("seat_number", parsed.data.seatNumber)
    .maybeSingle();

  if (seatError) return { success: false, error: seatError.message };

  if (seatOccupied) {
    if (seatOccupied.member_id) {
      return { success: false, error: "El asiento ya está ocupado." };
    }
    // Existing empty placeholder row — update it
    const { error: updateError } = await supabase
      .from("dance_positions")
      .update({ member_id: parsed.data.memberId })
      .eq("id", seatOccupied.id);
    if (updateError) {
      if (updateError.code === UNIQUE_VIOLATION) {
        return { success: false, error: "La bailarina ya está asignada a otro asiento en esta formación." };
      }
      return { success: false, error: updateError.message };
    }
    return { success: true, id: seatOccupied.id };
  }

  // Free seat — insert new row
  const { data, error } = await supabase
    .from("dance_positions")
    .insert({
      formation_id: parsed.data.formationId,
      row_number: parsed.data.rowNumber,
      seat_number: parsed.data.seatNumber,
      member_id: parsed.data.memberId,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // Could be seat or member duplicate — discriminate via message
      if (error.message.includes("idx_dance_positions_unique_member")) {
        return { success: false, error: "La bailarina ya está asignada a otro asiento en esta formación." };
      }
      return { success: false, error: "El asiento ya está ocupado." };
    }
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return { success: false, error: "La formación no existe." };
    }
    return { success: false, error: error.message };
  }

  return { success: true, id: data.id };
}

export async function removeDancerFromSeat(input: RemoveDancerInput): Promise<MutationResult> {
  const parsed = removeDancerSchema.safeParse(input);
  if (!parsed.success) return parseError(parsed.error);

  const authResult = await requireManagementGuard();
  if (!("id" in authResult)) return authResult;

  const supabase = await createClient();

  // Validate formation is dance
  const { data: formation, error: formationError } = await supabase
    .from("dance_formations")
    .select("formation_type")
    .eq("id", parsed.data.formationId)
    .maybeSingle();
  if (formationError) return { success: false, error: formationError.message };
  if (!formation) return { success: false, error: "Formación no encontrada." };
  if ((formation.formation_type as string) !== "dance") {
    return { success: false, error: "Esta formación es de música; no contiene posiciones de baile." };
  }

  const { data, error } = await supabase
    .from("dance_positions")
    .delete()
    .eq("formation_id", parsed.data.formationId)
    .eq("row_number", parsed.data.rowNumber)
    .eq("seat_number", parsed.data.seatNumber)
    .select("id")
    .maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "El asiento ya está vacío." };

  return { success: true };
}

export async function moveDancer(input: MoveDancerInput): Promise<MutationResult> {
  const parsed = moveDancerSchema.safeParse(input);
  if (!parsed.success) return parseError(parsed.error);

  const authResult = await requireManagementGuard();
  if (!("id" in authResult)) return authResult;

  // No-op if same seat
  if (
    parsed.data.fromRowNumber === parsed.data.toRowNumber &&
    parsed.data.fromSeatNumber === parsed.data.toSeatNumber
  ) {
    return { success: false, error: "El asiento origen y destino son el mismo." };
  }

  const supabase = await createClient();

  // Validate formation is dance
  const { data: formation, error: formationError } = await supabase
    .from("dance_formations")
    .select("formation_type")
    .eq("id", parsed.data.formationId)
    .maybeSingle();
  if (formationError) return { success: false, error: formationError.message };
  if (!formation) return { success: false, error: "Formación no encontrada." };
  if ((formation.formation_type as string) !== "dance") {
    return { success: false, error: "Esta formación es de música; no se pueden mover bailarinas." };
  }

  // Fetch source seat (must exist with a member)
  const { data: source, error: sourceError } = await supabase
    .from("dance_positions")
    .select("id, member_id")
    .eq("formation_id", parsed.data.formationId)
    .eq("row_number", parsed.data.fromRowNumber)
    .eq("seat_number", parsed.data.fromSeatNumber)
    .maybeSingle();

  if (sourceError) return { success: false, error: sourceError.message };
  if (!source || !source.member_id) {
    return { success: false, error: "El asiento origen está vacío." };
  }

  // Fetch dest seat (may be empty)
  const { data: dest, error: destError } = await supabase
    .from("dance_positions")
    .select("id, member_id")
    .eq("formation_id", parsed.data.formationId)
    .eq("row_number", parsed.data.toRowNumber)
    .eq("seat_number", parsed.data.toSeatNumber)
    .maybeSingle();

  if (destError) return { success: false, error: destError.message };

  if (!dest) {
    // Dest empty — move by updating coordinates (or delete+insert to avoid unique issues)
    // Approach: update source row's coordinates to dest
    const { error: moveError } = await supabase
      .from("dance_positions")
      .update({
        row_number: parsed.data.toRowNumber,
        seat_number: parsed.data.toSeatNumber,
      })
      .eq("id", source.id);

    if (moveError) {
      if (moveError.code === UNIQUE_VIOLATION) {
        return { success: false, error: "El asiento destino ya está ocupado." };
      }
      return { success: false, error: moveError.message };
    }
    return { success: true };
  }

  // Dest occupied — swap member_id values (coordinates stay, avoids seat unique violation)
  const sourceMember = source.member_id;
  const destMember = dest.member_id;

  // If dest is empty placeholder (member_id null), just move
  if (!destMember) {
    // Move source member to dest placeholder, delete source row
    const { error: upd1 } = await supabase
      .from("dance_positions")
      .update({ member_id: sourceMember })
      .eq("id", dest.id);
    if (upd1) return { success: false, error: upd1.message };

    const { error: del } = await supabase.from("dance_positions").delete().eq("id", source.id);
    if (del) return { success: false, error: del.message };
    return { success: true };
  }

  // Both occupied — swap
  // Use a temporary null to avoid partial unique member violation intermediate state:
  // The UNIQUE(formation_id, member_id) partial would conflict if we try to update
  // one row to the other's member before clearing. So clear source first.
  const { error: clearError } = await supabase
    .from("dance_positions")
    .update({ member_id: null })
    .eq("id", source.id);

  if (clearError) return { success: false, error: clearError.message };

  const { error: destUpdateError } = await supabase
    .from("dance_positions")
    .update({ member_id: sourceMember })
    .eq("id", dest.id);

  if (destUpdateError) {
    // Rollback: restore source
    await supabase.from("dance_positions").update({ member_id: sourceMember }).eq("id", source.id);
    if (destUpdateError.code === UNIQUE_VIOLATION) {
      return { success: false, error: "La bailarina ya está asignada a otro asiento en esta formación." };
    }
    return { success: false, error: destUpdateError.message };
  }

  const { error: sourceUpdateError } = await supabase
    .from("dance_positions")
    .update({ member_id: destMember })
    .eq("id", source.id);

  if (sourceUpdateError) {
    // Rollback dest
    await supabase.from("dance_positions").update({ member_id: destMember }).eq("id", dest.id);
    await supabase.from("dance_positions").update({ member_id: sourceMember }).eq("id", source.id);
    return { success: false, error: sourceUpdateError.message };
  }

  return { success: true };
}

export async function assignInstrumentToMusician(input: AssignInstrumentInput): Promise<MutationResult> {
  const parsed = assignInstrumentSchema.safeParse(input);
  if (!parsed.success) return parseError(parsed.error);

  const authResult = await requireManagementGuard();
  if (!("id" in authResult)) return authResult;

  const supabase = await createClient();

  // If linked to formation, validate formation is music type
  const _formationId = parsed.data.formationId ?? null;
  if (_formationId) {
    const { data: formation, error: formationError } = await supabase
      .from("dance_formations")
      .select("formation_type")
      .eq("id", _formationId)
      .maybeSingle();
    if (formationError) return { success: false, error: formationError.message };
    if (!formation) return { success: false, error: "Formación no encontrada." };
    if ((formation.formation_type as string) !== "music") {
      return { success: false, error: "Esta formación es de baile; no se pueden asignar instrumentos." };
    }
  }

  // Validate musician component_type = music
  const { data: musician, error: musicianError } = await supabase
    .from("profiles")
    .select("id, component_type, is_active, status, deleted_at")
    .eq("id", parsed.data.userId)
    .maybeSingle();

  if (musicianError) return { success: false, error: musicianError.message };
  if (!musician) return { success: false, error: "Músico no encontrado." };
  if (musician.component_type !== "music") {
    return { success: false, error: "Solo músicos pueden tener instrumentos asignados." };
  }
  if (!musician.is_active || musician.status !== "active" || musician.deleted_at !== null) {
    return { success: false, error: "El músico seleccionado ya no está disponible." };
  }

  // Validate instrument exists and is_active
  const { data: instrument, error: instrumentError } = await supabase
    .from("instruments")
    .select("id, is_active")
    .eq("id", parsed.data.instrumentId)
    .maybeSingle();

  if (instrumentError) return { success: false, error: instrumentError.message };
  if (!instrument) return { success: false, error: "Instrumento no encontrado." };
  if (!instrument.is_active) return { success: false, error: "No se puede asignar un instrumento inactivo." };

  const formationId = _formationId;

  // Workaround: .is() with null handling — if formationId is null, use is, else eq
  let existingQuery = supabase.from("musician_instruments").select("id, instrument_id").eq("user_id", parsed.data.userId);
  if (formationId === null) {
    existingQuery = existingQuery.is("formation_id", null);
  } else {
    existingQuery = existingQuery.eq("formation_id", formationId);
  }
  const { data: existingForUser } = await existingQuery.maybeSingle();

  if (existingForUser) {
    // User already has instrument in this formation — update it (change instrument)
    if (existingForUser.instrument_id === parsed.data.instrumentId) {
      return { success: false, error: "El músico ya tiene ese instrumento asignado." };
    }
    const { error: updateError } = await supabase
      .from("musician_instruments")
      .update({ instrument_id: parsed.data.instrumentId, assigned_by: authResult.id, assigned_at: new Date().toISOString() })
      .eq("id", existingForUser.id);

    if (updateError) {
      if (updateError.code === UNIQUE_VIOLATION) {
        return { success: false, error: "El instrumento ya está asignado a otro músico en esta formación." };
      }
      return { success: false, error: updateError.message };
    }
    return { success: true, id: existingForUser.id };
  }

  // New assignment
  const { data, error } = await supabase
    .from("musician_instruments")
    .insert({
      user_id: parsed.data.userId,
      instrument_id: parsed.data.instrumentId,
      formation_id: formationId,
      assigned_by: authResult.id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      // Could be user duplicate or instrument duplicate
      return { success: false, error: "El instrumento ya está asignado o el músico ya tiene uno en esta formación." };
    }
    if (error.code === FOREIGN_KEY_VIOLATION) {
      return { success: false, error: "La formación o el instrumento no existe." };
    }
    return { success: false, error: error.message };
  }

  return { success: true, id: data.id };
}

export async function unassignInstrument(input: UnassignInstrumentInput): Promise<MutationResult> {
  const parsed = unassignInstrumentSchema.safeParse(input);
  if (!parsed.success) return parseError(parsed.error);

  const authResult = await requireManagementGuard();
  if (!("id" in authResult)) return authResult;

  const supabase = await createClient();

  let query = supabase.from("musician_instruments").delete().eq("user_id", parsed.data.userId);
  const formationId = parsed.data.formationId ?? null;
  if (formationId === null) {
    query = query.is("formation_id", null);
  } else {
    query = query.eq("formation_id", formationId);
  }

  const { data, error } = await query.select("id").maybeSingle();

  if (error) return { success: false, error: error.message };
  if (!data) return { success: false, error: "El músico no tiene instrumento asignado en esta formación." };

  return { success: true };
}

export async function duplicateFormation(formationId: string): Promise<MutationResult> {
  const authResult = await requireManagementGuard();
  if (!("id" in authResult)) return authResult;

  if (!formationId || typeof formationId !== "string") {
    return { success: false, error: "ID de formación no válido." };
  }

  const supabase = await createClient();

  const { data: original, error: originalError } = await supabase
    .from("dance_formations")
    .select("id, name, event_id, formation_type")
    .eq("id", formationId)
    .maybeSingle();

  if (originalError) return { success: false, error: originalError.message };
  if (!original) return { success: false, error: "Formación no encontrada." };

  const newName = `${original.name} (copia)`.slice(0, 200);

  const { data: newFormation, error: createError } = await supabase
    .from("dance_formations")
    .insert({
      name: newName,
      event_id: null,
      created_by: authResult.id,
      formation_type: original.formation_type,
    })
    .select("id")
    .single();

  if (createError) return { success: false, error: createError.message };

  const newId = newFormation.id;

  // Copy positions
  const { data: positions, error: positionsError } = await supabase
    .from("dance_positions")
    .select("row_number, seat_number, member_id")
    .eq("formation_id", formationId);

  if (positionsError) return { success: false, error: positionsError.message };

  if (positions && positions.length > 0) {
    const rows = positions.map((p) => ({
      formation_id: newId,
      row_number: p.row_number,
      seat_number: p.seat_number,
      member_id: p.member_id,
    }));
    const { error: insertError } = await supabase.from("dance_positions").insert(rows);
    if (insertError) return { success: false, error: insertError.message };
  }

  // Copy musician instruments linked to this formation
  const { data: musicianRows, error: musicianError } = await supabase
    .from("musician_instruments")
    .select("user_id, instrument_id, assigned_by")
    .eq("formation_id", formationId);

  if (musicianError) return { success: false, error: musicianError.message };

  if (musicianRows && musicianRows.length > 0) {
    const mRows = musicianRows.map((r) => ({
      user_id: r.user_id,
      instrument_id: r.instrument_id,
      formation_id: newId,
      assigned_by: authResult.id,
    }));
    const { error: mInsertError } = await supabase.from("musician_instruments").insert(mRows);
    if (mInsertError) {
      // Non-fatal? But report
      return { success: false, error: mInsertError.message };
    }
  }

  return { success: true, id: newId };
}
