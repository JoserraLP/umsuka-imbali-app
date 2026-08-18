import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import type {
  AudienceType,
  ComponentType,
  NotificationType,
  Workgroup,
} from "@/types/database.types";

const WORKGROUPS: readonly Workgroup[] = ["telas", "barra", "estandarte", "limpieza", "ninguno"];
const COMPONENT_TYPES: readonly ComponentType[] = ["music", "dance", "member"];

/** Type guard for the Workgroup union (fail-closed: null → false). */
function isWorkgroup(value: string | null): value is Workgroup {
  return value !== null && (WORKGROUPS as readonly string[]).includes(value);
}

/** Type guard for the ComponentType union (fail-closed: null → false). */
function isComponentType(value: string | null): value is ComponentType {
  return value !== null && (COMPONENT_TYPES as readonly string[]).includes(value);
}

/**
 * Central notification emitter (Sprint 20). Other modules call
 * `notifyUsers` after their own inserts to fan out in-app notifications.
 *
 * BEST-EFFORT CONTRACT: every function in this module logs failures via
 * `console.error` and NEVER re-throws — a notification delivery problem
 * must never break the business mutation that triggered it. The
 * try/catch boundaries are internal, so callers can `await` freely.
 *
 * SECURITY: this module uses the service-role client (bypasses RLS) on
 * purpose, because it inserts notifications "on behalf of" other users.
 * Recipient ids MUST therefore be resolved from the database or from
 * privileged server state — never from client input. The `server-only`
 * import guarantees a build-time failure if this module is ever pulled
 * into a Client Component bundle.
 */

export interface NotifyUsersInput {
  /** Recipient profile/auth user ids (deduped internally). */
  userIds: string[];
  type: NotificationType;
  title: string;
  message?: string | null;
  link?: string | null;
}

/**
 * Fetches every active member's id (profiles.status = 'active').
 * Returns [] on failure (best-effort contract).
 */
export async function getAllActiveMemberIds(): Promise<string[]> {
  try {
    const admin = createAdminClient();
    const { data, error } = await admin.from("profiles").select("id").eq("status", "active");

    if (error) {
      console.error("getAllActiveMemberIds: no se pudo consultar miembros activos:", {
        message: error.message,
        code: error.code,
      });
      return [];
    }

    return (data ?? []).map((row) => row.id);
  } catch (err) {
    console.error("getAllActiveMemberIds: error inesperado:", err);
    return [];
  }
}

export interface EventRecipientsInput {
  audience_type: AudienceType;
  audience_workgroup: string | null;
  audience_member_type: string | null;
  audience_user_ids: string[];
}

/**
 * Resolves the concrete recipient user ids of an event audience (Sprint
 * 18 semantics): 'all' → every active member, 'workgroup' → profiles of
 * that group, 'member_type' → profiles of that component type,
 * 'specific_users' → the listed ids (deduped). Unknown audience types
 * fail closed with []. Never throws (best-effort contract).
 */
export async function resolveEventRecipients(input: EventRecipientsInput): Promise<string[]> {
  switch (input.audience_type) {
    case "all":
      return getAllActiveMemberIds();
    case "workgroup": {
      const workgroup = input.audience_workgroup;
      if (!isWorkgroup(workgroup)) return [];
      try {
        const admin = createAdminClient();
        const { data, error } = await admin
          .from("profiles")
          .select("id")
          .eq("workgroup", workgroup);

        if (error) {
          console.error("resolveEventRecipients: no se pudieron obtener destinatarios del grupo:", {
            message: error.message,
            code: error.code,
          });
          return [];
        }

        return (data ?? []).map((row) => row.id);
      } catch (err) {
        console.error("resolveEventRecipients: error inesperado al resolver grupo:", err);
        return [];
      }
    }
    case "member_type": {
      const memberType = input.audience_member_type;
      if (!isComponentType(memberType)) return [];
      try {
        const admin = createAdminClient();
        const { data, error } = await admin
          .from("profiles")
          .select("id")
          .eq("component_type", memberType);

        if (error) {
          console.error(
            "resolveEventRecipients: no se pudieron obtener destinatarios por tipo de miembro:",
            { message: error.message, code: error.code },
          );
          return [];
        }

        return (data ?? []).map((row) => row.id);
      } catch (err) {
        console.error("resolveEventRecipients: error inesperado al resolver tipo de miembro:", err);
        return [];
      }
    }
    case "specific_users":
      return [...new Set(input.audience_user_ids)];
    default:
      return [];
  }
}

/**
 * Fans out one notification to the given users, honoring each recipient's
 * `notification_preferences`: a missing row or `types = '{}'` means
 * "receive everything"; a non-empty array opts out of every type not
 * listed. All deliveries for a batch are written in a SINGLE INSERT
 * statement. Failures are logged and swallowed (best-effort contract).
 */
export async function notifyUsers({
  userIds,
  type,
  title,
  message,
  link,
}: NotifyUsersInput): Promise<void> {
  try {
    const uniqueIds = [...new Set(userIds)];
    if (uniqueIds.length === 0) return;

    const admin = createAdminClient();

    const { data: preferenceRows, error: preferencesError } = await admin
      .from("notification_preferences")
      .select("user_id, types")
      .in("user_id", uniqueIds);

    if (preferencesError) {
      console.error("notifyUsers: no se pudieron leer las preferencias:", {
        message: preferencesError.message,
        code: preferencesError.code,
      });
      return;
    }

    const typesByUser = new Map<string, NotificationType[]>(
      (preferenceRows ?? []).map((row) => [row.user_id, row.types]),
    );

    const recipients = uniqueIds.filter((userId) => {
      const types = typesByUser.get(userId);
      // Missing row (legacy account) or empty array: receive everything.
      if (types === undefined || types.length === 0) return true;
      return types.includes(type);
    });

    if (recipients.length === 0) return;

    const { error: insertError } = await admin.from("notifications").insert(
      recipients.map((user_id) => ({
        user_id,
        title,
        message: message ?? null,
        link: link ?? null,
        type,
      })),
    );

    if (insertError) {
      console.error("notifyUsers: no se pudo insertar el lote de notificaciones:", {
        message: insertError.message,
        code: insertError.code,
      });
    }
  } catch (err) {
    console.error("notifyUsers: error inesperado (best-effort, no se re-lanza):", err);
  }
}
