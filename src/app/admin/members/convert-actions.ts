"use server";

import { convertPendingToLocal as convertFn, revertLocalToPending as revertFn } from "@/lib/members/convert-to-local";
import type { ConvertPendingToLocalInput, RevertLocalToPendingInput } from "@/lib/members/convert-to-local";

export async function convertPendingToLocal(input: ConvertPendingToLocalInput) {
  return convertFn(input);
}

export async function revertLocalToPending(input: RevertLocalToPendingInput) {
  return revertFn(input);
}
