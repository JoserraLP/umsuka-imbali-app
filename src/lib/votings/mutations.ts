import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";
import type { AuthenticatedProfile } from "@/types/auth";
import { isVotingOpenEffective } from "@/lib/votings/logic";
import {
  createVotingSchema,
  addOptionSchema,
  castVoteSchema,
  closeVotingSchema,
  MAX_VOTING_OPTIONS,
  type CreateVotingInput,
  type AddOptionInput,
  type CastVoteInput,
  type CloseVotingInput,
} from "@/lib/votings/schema";

export interface MutationResult {
  success: boolean;
  error?: string;
  id?: string;
}

const UNIQUE_VIOLATION = "23505";

// ── Authorization helpers ─────────────────────────────

/**
 * Asserts the current user holds a management role.
 * Returns the authenticated profile on success, or an error result
 * otherwise (no DB writes are performed in that case).
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

function parseError(errors: {
  issues: { message: string }[];
}): MutationResult {
  return {
    success: false,
    error: errors.issues.map((issue) => issue.message).join(", "),
  };
}

// ── Mutations ─────────────────────────────────────────

/**
 * Creates a voting with its options. Only management can create votings.
 * If inserting the options fails (e.g. unique violation), the voting row
 * is deleted best-effort so no orphan votings are left behind.
 */
export async function createVoting(
  input: CreateVotingInput,
): Promise<MutationResult> {
  const parsed = createVotingSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard(
    "Solo la directiva puede crear votaciones.",
  );
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("votings")
    .insert({
      title: parsed.data.title,
      description: parsed.data.description ?? null,
      voting_deadline: parsed.data.voting_deadline ?? null,
      is_open: true,
    })
    .select("id")
    .single();

  if (error) {
    return { success: false, error: error.message };
  }

  const votingId = data.id;

  const { error: optionsError } = await supabase
    .from("voting_options")
    .insert(
      parsed.data.options.map((optionText) => ({
        voting_id: votingId,
        option_text: optionText,
      })),
    );

  if (optionsError) {
    // Best-effort rollback so a failed create does not leave an orphan voting.
    await supabase.from("votings").delete().eq("id", votingId);

    if (optionsError.code === UNIQUE_VIOLATION) {
      return {
        success: false,
        error: "Ya existe una opción con ese enunciado.",
      };
    }

    return { success: false, error: optionsError.message };
  }

  return { success: true, id: votingId };
}

/**
 * Adds an option to an open voting. Only management can add options.
 */
export async function addOption(
  input: AddOptionInput,
): Promise<MutationResult> {
  const parsed = addOptionSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard(
    "Solo la directiva puede añadir opciones.",
  );
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const { data: voting, error: votingError } = await supabase
    .from("votings")
    .select("is_open, voting_deadline")
    .eq("id", parsed.data.voting_id)
    .maybeSingle();

  if (votingError || !voting) {
    return { success: false, error: "Votación no encontrada." };
  }

  if (!isVotingOpenEffective(voting, new Date())) {
    return { success: false, error: "La votación está cerrada." };
  }

  // Enforce the per-voting option ceiling (schema enforces it at create
  // time; this guard also covers options added later).
  const { data: optionRows, error: countError } = await supabase
    .from("voting_options")
    .select("id")
    .eq("voting_id", parsed.data.voting_id);

  if (countError) {
    return { success: false, error: countError.message };
  }

  if ((optionRows ?? []).length >= MAX_VOTING_OPTIONS) {
    return { success: false, error: "Máximo 20 opciones por votación." };
  }

  const { error } = await supabase.from("voting_options").insert({
    voting_id: parsed.data.voting_id,
    option_text: parsed.data.option_text,
  });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      return { success: false, error: "Esa opción ya existe." };
    }
    return { success: false, error: error.message };
  }

  return { success: true };
}

/**
 * Casts a single vote for the authenticated user. The user id always
 * comes from the session (actor.id), never from the client input.
 * A unique constraint on (voting_id, user_id) plus a pre-check guard
 * against double voting; the 23505 code is mapped to a friendly message
 * as a race-condition defense.
 */
export async function castVote(
  input: CastVoteInput,
): Promise<MutationResult> {
  const parsed = castVoteSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const actor = await requireAuthenticatedProfile();

  const supabase = await createClient();

  const { data: voting, error: votingError } = await supabase
    .from("votings")
    .select("is_open, voting_deadline")
    .eq("id", parsed.data.voting_id)
    .maybeSingle();

  if (votingError || !voting) {
    return { success: false, error: "Votación no encontrada." };
  }

  if (!isVotingOpenEffective(voting, new Date())) {
    return { success: false, error: "La votación está cerrada." };
  }

  // Defend against casting a vote for an option of another voting.
  const { data: option, error: optionError } = await supabase
    .from("voting_options")
    .select("id")
    .eq("id", parsed.data.option_id)
    .eq("voting_id", parsed.data.voting_id)
    .maybeSingle();

  if (optionError || !option) {
    return {
      success: false,
      error: "La opción no pertenece a esta votación.",
    };
  }

  // Pre-check for an existing vote (the unique constraint is the final defense).
  const { data: existingVote, error: existingError } = await supabase
    .from("voting_votes")
    .select("id")
    .eq("voting_id", parsed.data.voting_id)
    .eq("user_id", actor.id)
    .maybeSingle();

  if (existingError) {
    return { success: false, error: existingError.message };
  }

  if (existingVote) {
    return { success: false, error: "Ya has votado en esta votación." };
  }

  const { error: insertError } = await supabase
    .from("voting_votes")
    .insert({
      voting_id: parsed.data.voting_id,
      option_id: parsed.data.option_id,
      user_id: actor.id,
    });

  if (insertError) {
    if (insertError.code === UNIQUE_VIOLATION) {
      return { success: false, error: "Ya has votado en esta votación." };
    }
    return { success: false, error: insertError.message };
  }

  return { success: true };
}

/**
 * Closes a voting (is_open = false). Only management can close votings.
 */
export async function closeVoting(
  input: CloseVotingInput,
): Promise<MutationResult> {
  const parsed = closeVotingSchema.safeParse(input);
  if (!parsed.success) {
    return parseError(parsed.error);
  }

  const authResult = await requireManagementGuard(
    "Solo la directiva puede cerrar votaciones.",
  );
  if (!("id" in authResult)) {
    return authResult;
  }

  const supabase = await createClient();

  const { data, error } = await supabase
    .from("votings")
    .update({ is_open: false })
    .eq("id", parsed.data.voting_id)
    .select("id")
    .maybeSingle();

  if (error) {
    return { success: false, error: error.message };
  }

  if (!data) {
    return { success: false, error: "Votación no encontrada." };
  }

  return { success: true };
}