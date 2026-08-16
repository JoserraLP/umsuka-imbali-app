import { createClient } from "@/lib/supabase/server";
import {
  isVotingOpenEffective,
  type VotingResultsRow,
} from "@/lib/votings/logic";

// ── Types ─────────────────────────────────────────────

export interface VotingItem {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  isOpen: boolean;
  optionCount: number;
}

export interface VotingOption {
  id: string;
  optionText: string;
}

export interface VotingDetail {
  id: string;
  title: string;
  description: string | null;
  createdAt: string;
  votingDeadline: string | null;
  /** Effective state: raw flag AND deadline still in the future. */
  isOpen: boolean;
  /** Raw `is_open` flag from the database row (management close action). */
  isOpenRaw: boolean;
  options: VotingOption[];
  hasVoted: boolean;
  chosenOptionId: string | null;
}

export type { VotingResultsRow };

// ── Queries ───────────────────────────────────────────

/**
 * Returns all votings (newest first) with their option counts and
 * effective open/closed state.
 */
export async function getVotings(): Promise<VotingItem[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("votings")
    .select("id, title, description, is_open, voting_deadline, created_at")
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Error al obtener votaciones: ${error.message}`);
  }

  const rows = data ?? [];
  const ids = rows.map((row) => row.id);

  const optionCounts = new Map<string, number>();
  if (ids.length > 0) {
    const { data: options, error: optionsError } = await supabase
      .from("voting_options")
      .select("id, voting_id")
      .in("voting_id", ids);

    if (optionsError) {
      throw new Error(`Error al obtener opciones: ${optionsError.message}`);
    }

    for (const option of options ?? []) {
      if (option.voting_id) {
        optionCounts.set(
          option.voting_id,
          (optionCounts.get(option.voting_id) ?? 0) + 1,
        );
      }
    }
  }

  const now = new Date();
  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    description: row.description,
    createdAt: row.created_at,
    isOpen: isVotingOpenEffective(
      { is_open: row.is_open, voting_deadline: row.voting_deadline },
      now,
    ),
    optionCount: optionCounts.get(row.id) ?? 0,
  }));
}

/**
 * Returns a single voting by ID with its options sorted alphabetically.
 * When `userId` is provided, also resolves whether that user already
 * voted and which option they chose. Returns null when the voting
 * doesn't exist.
 */
export async function getVotingById(
  id: string,
  userId?: string,
): Promise<VotingDetail | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("votings")
    .select("id, title, description, is_open, voting_deadline, created_at")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    throw new Error(`Error al obtener votación: ${error.message}`);
  }

  if (!data) return null;

  const { data: optionRows, error: optionsError } = await supabase
    .from("voting_options")
    .select("id, option_text")
    .eq("voting_id", id)
    .order("option_text", { ascending: true });

  if (optionsError) {
    throw new Error(`Error al obtener opciones: ${optionsError.message}`);
  }

  let hasVoted = false;
  let chosenOptionId: string | null = null;

  if (userId) {
    const { data: vote, error: voteError } = await supabase
      .from("voting_votes")
      .select("option_id")
      .eq("voting_id", id)
      .eq("user_id", userId)
      .maybeSingle();

    if (voteError) {
      throw new Error(`Error al obtener tu voto: ${voteError.message}`);
    }

    if (vote) {
      hasVoted = true;
      chosenOptionId = vote.option_id ?? null;
    }
  }

  return {
    id: data.id,
    title: data.title,
    description: data.description,
    createdAt: data.created_at,
    votingDeadline: data.voting_deadline,
    isOpen: isVotingOpenEffective(
      { is_open: data.is_open, voting_deadline: data.voting_deadline },
      new Date(),
    ),
    isOpenRaw: data.is_open,
    options: (optionRows ?? []).map((option) => ({
      id: option.id,
      optionText: option.option_text,
    })),
    hasVoted,
    chosenOptionId,
  };
}

/**
 * Returns the per-option results through the SECURITY DEFINER RPC
 * `umsuka.get_voting_results`. The database enforces the visibility
 * rule (results hidden until the caller votes or the voting closes).
 */
export async function getResults(
  votingId: string,
): Promise<VotingResultsRow[]> {
  const supabase = await createClient();

  const { data, error } = await supabase.rpc("get_voting_results", {
    p_voting_id: votingId,
  });

  if (error) {
    throw new Error(`Error al obtener resultados: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    optionId: row.option_id,
    optionText: row.option_text,
    votes: row.votes,
    totalVotes: row.total_votes,
    percentage: row.percentage,
  }));
}