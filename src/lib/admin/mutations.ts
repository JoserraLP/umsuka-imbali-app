import "server-only";
import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/admin/permissions";
import {
  updateSettingSchema,
  logAuditActionSchema,
  type LogAuditInput,
  type UpdateSettingInput,
} from "@/lib/admin/schema";
import { updateMemberRoleSchema, setMemberActiveSchema } from "@/lib/profiles/schema";
import {
  updateMemberRole as profilesUpdateMemberRole,
  setMemberActive as profilesSetMemberActive,
} from "@/lib/profiles/mutations";
import { approveUserSchema, suspendUserSchema } from "@/lib/approvals/schema";
import {
  approveUser as approvalsApproveUser,
  suspendUser as approvalsSuspendUser,
} from "@/lib/approvals/mutations";
import type { AppRole, Json } from "@/types/database.types";
import type { UpdateMemberRoleInput, SetMemberActiveInput } from "@/lib/profiles/schema";
import type { ApproveUserInput, SuspendUserInput } from "@/lib/approvals/schema";

/**
 * Server-side admin mutations (Sprint 21). Every mutation starts by
 * resolving the authenticated actor and re-checking the granular
 * permission it serves (`settings.write` / `users.manage`); the writes
 * go through the authenticated client, so the RLS policies of migration
 * 0053 are the final backstop. Every successful administrative change
 * writes exactly ONE audit row via `logAuditAction` (best-effort — an
 * audit failure can never fail the business mutation).
 */

export interface MutationResult {
  success: boolean;
  error?: string;
}

function toErrorResult(err: unknown): MutationResult {
  if (err instanceof AuthorizationError) {
    return { success: false, error: err.message };
  }
  throw err;
}

/**
 * Upserts a global setting (onConflict "key") and audits the change
 * exactly once. Only callable by roles holding `settings.write`.
 */
export async function updateSetting(input: UpdateSettingInput): Promise<MutationResult> {
  const parsed = updateSettingSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();

  try {
    requirePermission(actor.role, "settings.write");
  } catch (err) {
    return toErrorResult(err);
  }

  const supabase = await createClient();

  const { error } = await supabase
    .from("settings")
    .upsert(
      {
        key: parsed.data.key,
        value: parsed.data.value,
        updated_by: actor.id,
        // Explicit timestamp: Supabase's ON CONFLICT DO UPDATE would
        // otherwise leave updated_at untouched on re-saves (M2).
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );

  if (error) {
    return { success: false, error: error.message };
  }

  await logAuditAction({
    actorId: actor.id,
    action: "settings.updated",
    entityType: "settings",
    entityId: parsed.data.key,
  });

  return { success: true };
}

/**
 * Writes one append-only audit row through the authenticated admin
 * client (the RLS insert policy requires user_id = auth.uid() and an
 * admin caller). BEST-EFFORT CONTRACT (pattern of the notifications
 * emitter): invalid input, insert errors and unexpected throws are logged
 * with console.error and NEVER re-thrown — an audit failure must never
 * break the business mutation that triggered it. Callable from other
 * server modules (e.g. src/app/admin/users/actions.ts).
 */
export async function logAuditAction(input: LogAuditInput): Promise<void> {
  try {
    const parsed = logAuditActionSchema.safeParse(input);
    if (!parsed.success) {
      console.error(
        "logAuditAction: entrada inválida (no se registra):",
        parsed.error.issues.map((issue) => issue.message).join(", "),
      );
      return;
    }

    const supabase = await createClient();

    const { error } = await supabase.from("audit_logs").insert({
      user_id: parsed.data.actorId,
      action: parsed.data.action,
      entity_type: parsed.data.entityType,
      entity_id: parsed.data.entityId,
      details: (parsed.data.details ?? null) as Json | null,
    });

    if (error) {
      console.error("logAuditAction: no se pudo registrar:", {
        message: error.message,
        code: error.code,
      });
    }
  } catch (err) {
    console.error("logAuditAction: error inesperado (best-effort, no se re-lanza):", err);
  }
}

/**
 * Changes a member's role through the profiles module, auditing the
 * change with the previous role. The canAssignRole check stays inside
 * profiles.updateMemberRole (a plain admin cannot grant/revoke
 * super_admin/admin); a denial there produces NO audit row.
 */
export async function updateUserRole(input: UpdateMemberRoleInput): Promise<MutationResult> {
  const parsed = updateMemberRoleSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();

  try {
    requirePermission(actor.role, "users.manage");
  } catch (err) {
    return toErrorResult(err);
  }

  const supabase = await createClient();

  const { data: targetRow, error: readError } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", parsed.data.userId)
    .maybeSingle();

  if (readError) {
    return { success: false, error: readError.message };
  }

  const fromRole = (targetRow?.role as AppRole | undefined) ?? null;

  const result = await profilesUpdateMemberRole(parsed.data);
  if (!result.success) {
    return result;
  }

  await logAuditAction({
    actorId: actor.id,
    action: "user.role_changed",
    entityType: "profile",
    entityId: parsed.data.userId,
    details: { fromRole, toRole: parsed.data.role },
  });

  return result;
}

/**
 * Activates/deactivates a member through the profiles module, auditing
 * the action. The self-deactivation guard lives inside
 * profiles.setMemberActive; a denial there produces NO audit row.
 */
export async function setUserActive(input: SetMemberActiveInput): Promise<MutationResult> {
  const parsed = setMemberActiveSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();

  try {
    requirePermission(actor.role, "users.manage");
  } catch (err) {
    return toErrorResult(err);
  }

  const result = await profilesSetMemberActive(parsed.data);
  if (!result.success) {
    return result;
  }

  await logAuditAction({
    actorId: actor.id,
    action: parsed.data.isActive ? "user.activated" : "user.deactivated",
    entityType: "profile",
    entityId: parsed.data.userId,
  });

  return result;
}

/**
 * Approves a pending user through the approvals module (which emits the
 * profile_approved notification), auditing the approval once.
 */
export async function approveUser(input: ApproveUserInput): Promise<MutationResult> {
  const parsed = approveUserSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();

  try {
    requirePermission(actor.role, "users.manage");
  } catch (err) {
    return toErrorResult(err);
  }

  const result = await approvalsApproveUser(parsed.data);
  if (!result.success) {
    return result;
  }

  await logAuditAction({
    actorId: actor.id,
    action: "user.approved",
    entityType: "profile",
    entityId: parsed.data.userId,
  });

  return result;
}

/**
 * Suspends a user through the approvals module, auditing the suspension
 * once. The self-suspend guard lives inside approvals.suspendUser; a
 * denial there produces NO audit row.
 */
export async function suspendUser(input: SuspendUserInput): Promise<MutationResult> {
  const parsed = suspendUserSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: parsed.error.issues.map((issue) => issue.message).join(", ") };
  }

  const actor = await requireAuthenticatedProfile();

  try {
    requirePermission(actor.role, "users.manage");
  } catch (err) {
    return toErrorResult(err);
  }

  const result = await approvalsSuspendUser(parsed.data);
  if (!result.success) {
    return result;
  }

  await logAuditAction({
    actorId: actor.id,
    action: "user.suspended",
    entityType: "profile",
    entityId: parsed.data.userId,
  });

  return result;
}