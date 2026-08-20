import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import type { AuthenticatedProfile } from "@/types/auth";
import {
  createInstrumentSchema,
  updateInstrumentSchema,
  assignSchema,
  unassignSchema,
  toggleInstrumentActiveSchema,
  type CreateInstrumentInput,
  type UpdateInstrumentInput,
  type AssignInstrumentInput,
  type UnassignInstrumentInput,
  type ToggleInstrumentActiveInput,
} from "@/lib/instruments/schema";

export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
}

const UNIQUE_VIOLATION = "23505";

// ── Authorization helpers ─────────────────────────────

/**
 * Asserts the current user holds a management role. Returns the
 * authenticated profile on success, or an error result otherwise (no DB
 * writes are performed in that case). Pattern: src/lib/votings/mutations.ts.
 */
async function requireManagementGuard(
  errorMessage: string,
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

/**
 * Creates an instrument in the inventory. Only management can do this.
 */
export async function createInstrument(
  input: CreateInstrumentInput,
): Promise<MutationResult> {
  const parsed = createInstrumentSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard("Solo la directiva puede gestionar instrumentos.");
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("instruments")
    .insert({
      name: parsed.data.name,
      category: parsed.data.category ?? null,
      description: parsed.data.description ?? null,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { success: false, error: "Ya existe un instrumento con ese nombre." };
    }
    return { success: false, error: error.message };
  }

  return { success: true, id: data.id };
}

/**
 * Edits the basic fields of an instrument. Only management can do this.
 */
export async function updateInstrument(
  input: UpdateInstrumentInput,
): Promise<MutationResult> {
  const parsed = updateInstrumentSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard("Solo la directiva puede gestionar instrumentos.");
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const { data: existing, error: fetchError } = await supabase
    .from("instruments")
    .select("id")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (fetchError) {
    return { success: false, error: fetchError.message };
  }

  if (!existing) {
    return { success: false, error: "Instrumento no encontrado." };
  }

  const { error } = await supabase
    .from("instruments")
    .update({
      name: parsed.data.name,
      category: parsed.data.category ?? null,
      description: parsed.data.description ?? null,
    })
    .eq("id", parsed.data.id);

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { success: false, error: "Ya existe un instrumento con ese nombre." };
    }
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Flips the is_active flag (logical deactivation / reactivation).
 * Only management can do this.
 */
export async function toggleInstrumentActive(
  input: ToggleInstrumentActiveInput,
): Promise<MutationResult> {
  const parsed = toggleInstrumentActiveSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard("Solo la directiva puede gestionar instrumentos.");
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const { data: instrument, error: fetchError } = await supabase
    .from("instruments")
    .select("is_active")
    .eq("id", parsed.data.instrument_id)
    .maybeSingle();

  if (fetchError) {
    return { success: false, error: fetchError.message };
  }

  if (!instrument) {
    return { success: false, error: "Instrumento no encontrado." };
  }

  const { error } = await supabase
    .from("instruments")
    .update({ is_active: !instrument.is_active })
    .eq("id", parsed.data.instrument_id);

  if (error) {
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Assigns a responsable to an instrument ("one person at a time"): the
 * previous active assignment is closed (unassigned_at = now) and then
 * the new one is inserted. The partial unique index on active
 * assignments is the final defense against concurrent assigns (23505 is
 * mapped to a friendly message). Inactive instruments cannot be
 * assigned. Only management can do this.
 */
export async function assignInstrument(
  input: AssignInstrumentInput,
): Promise<MutationResult> {
  const parsed = assignSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard("Solo la directiva puede gestionar instrumentos.");
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const { data: instrument, error: instrumentError } = await supabase
    .from("instruments")
    .select("is_active")
    .eq("id", parsed.data.instrument_id)
    .maybeSingle();

  if (instrumentError) {
    return { success: false, error: instrumentError.message };
  }

  if (!instrument) {
    return { success: false, error: "Instrumento no encontrado." };
  }

  if (!instrument.is_active) {
    return { success: false, error: "No se puede asignar un instrumento inactivo." };
  }

  // Close any previously active assignment for this instrument.
  const { error: closeError } = await supabase
    .from("instrument_assignments")
    .update({ unassigned_at: new Date().toISOString() })
    .eq("instrument_id", parsed.data.instrument_id)
    .is("unassigned_at", null);

  if (closeError) {
    return { success: false, error: closeError.message };
  }

  const { data, error } = await supabase
    .from("instrument_assignments")
    .insert({
      instrument_id: parsed.data.instrument_id,
      user_id: parsed.data.user_id,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return {
        success: false,
        error: "El instrumento ya tiene una persona responsable asignada.",
      };
    }
    return { success: false, error: error.message };
  }

  return { success: true, id: data.id };
}

/**
 * Unassigns the current responsable by closing the active assignment
 * (unassigned_at = now). The history row is never deleted. Only
 * management can do this.
 */
export async function unassignInstrument(
  input: UnassignInstrumentInput,
): Promise<MutationResult> {
  const parsed = unassignSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard("Solo la directiva puede gestionar instrumentos.");
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("instrument_assignments")
    .update({ unassigned_at: new Date().toISOString() })
    .eq("instrument_id", parsed.data.instrument_id)
    .is("unassigned_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return { success: false, error: error.message };
  }

  if (!data) {
    return {
      success: false,
      error: "El instrumento no tiene una persona responsable asignada.",
    };
  }

  return { success: true };
}