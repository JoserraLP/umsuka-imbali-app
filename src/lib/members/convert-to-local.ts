import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/permissions";
import { passwordStrengthSchema } from "@/lib/auth/password-schema";

export const convertPendingToLocalSchema = z.object({
  profileId: z.string().uuid("El identificador del perfil no es válido."),
  username: z
    .string()
    .trim()
    .min(3, "El nombre de usuario debe tener al menos 3 caracteres.")
    .max(30, "El nombre de usuario debe tener 30 caracteres o menos.")
    .regex(/^[a-zA-Z0-9_]+$/, "El nombre de usuario solo puede contener letras, números y guiones bajos."),
  password: passwordStrengthSchema,
});

export type ConvertPendingToLocalInput = z.infer<typeof convertPendingToLocalSchema>;

function requireSuperAdmin(profile: { role: string | null | undefined } | null): void {
  if (!profile || profile.role !== "super_admin") {
    throw new AuthorizationError("Solo el super_admin puede convertir cuentas.");
  }
}

/**
 * Convierte un perfil pending_gmail a cuenta local (email_alias).
 * Flujo:
 *  1. Verifica super_admin y que el perfil esté pending_gmail
 *  2. Valida username no duplicado y password
 *  3. Genera alias interno user-{uuid}@umsuka.internal
 *  4. Actualiza auth.users (email + password + metadata)
 *  5. Actualiza profiles (username, auth_method=email_alias, link_status=linked, invite_token=null)
 *  6. Inserta en email_aliases (profile_id, alias_email, created_by)
 *
 * Después el usuario entra por /auth/login con username/password.
 * El histórico (pagos, asistencia, etc.) se conserva porque la PK no cambia.
 */
export async function convertPendingToLocal(input: ConvertPendingToLocalInput) {
  const parsed = convertPendingToLocalSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  }
  const { profileId, username, password } = parsed.data;

  let actor: Awaited<ReturnType<typeof getCurrentProfile>>;
  try {
    actor = await getCurrentProfile();
    requireSuperAdmin(actor);
  } catch (e) {
    if (e instanceof AuthorizationError) return { success: false as const, error: e.message };
    return { success: false as const, error: "No tienes permisos." };
  }

  const admin = createAdminClient();

  // Verificar perfil destino
  const { data: target, error: fetchError } = await admin
    .from("profiles")
    .select("id, link_status, auth_method, username")
    .eq("id", profileId)
    .maybeSingle();

  if (fetchError) return { success: false as const, error: `Error al buscar perfil: ${fetchError.message}` };
  if (!target) return { success: false as const, error: "Perfil no encontrado." };
  if ((target as { link_status: string }).link_status !== "pending_gmail") {
    return { success: false as const, error: "Solo se pueden convertir perfiles pendientes de Gmail (pending_gmail)." };
  }
  if ((target as { auth_method: string }).auth_method === "email_alias") {
    return { success: false as const, error: "El perfil ya es cuenta local." };
  }

  // Username duplicado?
  const { data: existing } = await admin.from("profiles").select("id").eq("username", username).maybeSingle();
  if (existing) return { success: false as const, error: "El nombre de usuario ya está en uso." };

  const aliasEmail = `user-${crypto.randomUUID()}@umsuka.internal`;

  // 1. Actualizar auth.users (placeholder pending -> alias)
  const { error: authError } = await admin.auth.admin.updateUserById(profileId, {
    email: aliasEmail,
    password,
    email_confirm: true,
    user_metadata: { username, auth_method: "email_alias" },
  } as never);

  if (authError) {
    return { success: false as const, error: `No se pudo actualizar auth: ${authError.message}` };
  }

  // 2. Actualizar profiles
  const { error: profileError } = await admin
    .from("profiles")
    .update({
      username,
      auth_method: "email_alias",
      link_status: "linked",
      invite_token: null,
      pending_email: null,
    } as never)
    .eq("id", profileId);

  if (profileError) {
    return { success: false as const, error: `No se pudo actualizar perfil: ${profileError.message}` };
  }

  // 3. Insertar email_aliases
  const { error: aliasError } = await admin.from("email_aliases").insert({
    profile_id: profileId,
    alias_email: aliasEmail,
    created_by: actor!.id,
  } as never);

  if (aliasError) {
    // No es fatal, pero avisamos. El login por username resuelve el alias via email_aliases,
    // si no existe fallará. Intentar limpiar?
    return { success: false as const, error: `Perfil convertido pero fallo al crear alias: ${aliasError.message}` };
  }

  return { success: true as const, data: { id: profileId, username, aliasEmail } };
}

/**
 * Revierte una cuenta local a pendiente (por si se convierte por error).
 * Solo super_admin, solo si es email_alias y link_status linked.
 * Borra email_aliases, resetea auth a placeholder pending y deja link_status pending_gmail con nuevo invite_token.
 * No restaura Gmail previo.
 */
export const revertLocalToPendingSchema = z.object({
  profileId: z.string().uuid(),
});

export type RevertLocalToPendingInput = z.infer<typeof revertLocalToPendingSchema>;

export async function revertLocalToPending(input: RevertLocalToPendingInput) {
  const parsed = revertLocalToPendingSchema.safeParse(input);
  if (!parsed.success) return { success: false as const, error: "Datos no válidos." };
  const { profileId } = parsed.data;

  let actor: Awaited<ReturnType<typeof getCurrentProfile>>;
  try {
    actor = await getCurrentProfile();
    requireSuperAdmin(actor);
  } catch (e) {
    if (e instanceof AuthorizationError) return { success: false as const, error: e.message };
    return { success: false as const, error: "No tienes permisos." };
  }

  const admin = createAdminClient();
  const { data: target } = await admin.from("profiles").select("id, auth_method, link_status").eq("id", profileId).maybeSingle();
  if (!target) return { success: false as const, error: "Perfil no encontrado." };
  if ((target as { auth_method: string }).auth_method !== "email_alias") {
    return { success: false as const, error: "Solo se puede revertir una cuenta local." };
  }

  const newInvite = crypto.randomUUID();
  const placeholderEmail = `pending-${crypto.randomUUID()}@umsuka.pending`;

  const { error: authError } = await admin.auth.admin.updateUserById(profileId, {
    email: placeholderEmail,
    email_confirm: true,
    user_metadata: { pending_gmail: true },
  } as never);
  if (authError) return { success: false as const, error: authError.message };

  await admin.from("email_aliases").delete().eq("profile_id", profileId);

  const { error: profErr } = await admin
    .from("profiles")
    .update({
      username: null,
      auth_method: "google",
      link_status: "pending_gmail",
      invite_token: newInvite,
      pending_email: null,
    } as never)
    .eq("id", profileId);
  if (profErr) return { success: false as const, error: profErr.message };

  return { success: true as const, data: { id: profileId, invite_token: newInvite } };
}
