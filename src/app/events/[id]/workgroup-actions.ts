"use server";

import { revalidatePath } from "next/cache";
import {
  markWorkgroupAttendance,
  updateWorkgroupAttendance,
} from "@/lib/workgroups/mutations";
import type {
  MarkWorkgroupAttendanceInput,
  UpdateWorkgroupAttendanceInput,
} from "@/lib/workgroups/schema";
import type { MutationResult } from "@/lib/workgroups/mutations";

export async function markWorkgroupAttendanceAction(
  input: MarkWorkgroupAttendanceInput,
): Promise<MutationResult> {
  const result = await markWorkgroupAttendance(input);

  if (result.success) {
    revalidatePath(`/events/[id]`, "page");
  }

  return result;
}

export async function updateWorkgroupAttendanceAction(
  input: UpdateWorkgroupAttendanceInput,
): Promise<MutationResult> {
  const result = await updateWorkgroupAttendance(input);

  if (result.success) {
    revalidatePath(`/events/[id]`, "page");
  }

  return result;
}
