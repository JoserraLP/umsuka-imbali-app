"use server";

import { revalidatePath } from "next/cache";
import {
  createVoting,
  addOption,
  castVote,
  closeVoting,
} from "@/lib/votings/mutations";
import type {
  CreateVotingInput,
  AddOptionInput,
  CastVoteInput,
  CloseVotingInput,
} from "@/lib/votings/schema";
import type { MutationResult } from "@/lib/votings/mutations";

export async function createVotingAction(
  input: CreateVotingInput,
): Promise<MutationResult> {
  const result = await createVoting(input);

  if (result.success) {
    revalidatePath("/votings");
  }

  return result;
}

export async function addOptionAction(
  input: AddOptionInput,
): Promise<MutationResult> {
  const result = await addOption(input);

  if (result.success) {
    revalidatePath("/votings");
    revalidatePath(`/votings/${input.voting_id}`);
  }

  return result;
}

export async function castVoteAction(
  input: CastVoteInput,
): Promise<MutationResult> {
  const result = await castVote(input);

  if (result.success) {
    revalidatePath("/votings");
    revalidatePath(`/votings/${input.voting_id}`);
  }

  return result;
}

export async function closeVotingAction(
  input: CloseVotingInput,
): Promise<MutationResult> {
  const result = await closeVoting(input);

  if (result.success) {
    revalidatePath("/votings");
    revalidatePath(`/votings/${input.voting_id}`);
  }

  return result;
}