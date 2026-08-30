"use server";

import { revalidatePath } from "next/cache";
import { createSnapshot, startNewYear } from "@/lib/carnival/year";
import { createCarnivalYearSchema, startNewYearSchema } from "@/lib/carnival/schema";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/session";
import { isManagementRole } from "@/lib/auth/roles";

export async function createCarnivalYearAction(formData: FormData): Promise<{ success: boolean; error?: string; id?: string }> {
  const profile = await getCurrentProfile();
  if (!profile || !isManagementRole(profile.role as never)) return { success: false, error: "Solo directiva." };

  const parsed = createCarnivalYearSchema.safeParse({
    year: formData.get("year"),
    label: formData.get("label"),
    start_date: formData.get("start_date"),
    end_date: formData.get("end_date"),
  });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  const admin = createAdminClient();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (admin as any)
    .from("carnival_years")
    .insert({
      year: parsed.data.year,
      label: parsed.data.label,
      start_date: parsed.data.start_date,
      end_date: parsed.data.end_date,
      created_by: profile.id,
    })
    .select("id")
    .single();
  if (error) return { success: false, error: error.message };
  revalidatePath("/admin/carnival");
  return { success: true, id: (data as { id: string }).id };
}

export async function startNewCarnivalYearAction(formData: FormData): Promise<{ success: boolean; error?: string; newYearId?: string }> {
  const label = String(formData.get("label") ?? "");
  const startDate = String(formData.get("start_date") ?? "");
  const confirmText = String(formData.get("confirmText") ?? "");

  const parsed = startNewYearSchema.safeParse({ label, start_date: startDate, confirmText });
  if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };

  const res = await startNewYear({ label: parsed.data.label, startDate: parsed.data.start_date, confirmText: parsed.data.confirmText });
  if (!res.success) return { success: false, error: res.error };
  revalidatePath("/admin/carnival");
  revalidatePath("/admin/carnival/history");
  revalidatePath("/dashboard");
  return { success: true, newYearId: res.data.newYearId };
}

export async function createSnapshotAction(yearId: string): Promise<{ success: boolean; error?: string }> {
  const res = await createSnapshot(yearId);
  if (!res.success) return { success: false, error: res.error };
  revalidatePath("/admin/carnival/history");
  return { success: true };
}
