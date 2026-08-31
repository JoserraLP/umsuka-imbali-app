import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/auth/session";
import { AuthorizationError } from "@/lib/auth/permissions";
import { preRegisterMemberSchema, linkGmailSchema } from "@/lib/members/pre-register-schema";
import type { PreRegisterMemberInput, LinkGmailInput } from "@/lib/members/pre-register-schema";

/**
 * Sprint 40 — Vinculación LÓGICA por email (pending_email + link_status)
 * ===============================================================
 * Trade-off id vs auth.users:
 * - preRegisterMember genera id random (crypto.randomUUID()) para el perfil
 *   en estado pending_gmail. Ese id es la PK que ya usan FKs de histórico
 *   (pagos, formación, asistencia, shifts…).
 * - linkGmailToProfile / linkByInviteToken NO intentan UPDATE profiles.id = auth.uid()
 *   ni migrar el histórico. Migrar la PK rompería FKs y dejaría huérfanos.
 * - La vinculación es LÓGICA: tras vincular se hace
 *     UPDATE profiles SET link_status='linked', invite_token=null, pending_email=gmail
 *   sobre el MISMO id original. El histórico queda intacto porque la PK no cambia.
 * - El login futuro localiza el perfil por
 *     SELECT * FROM profiles WHERE pending_email = gmail AND link_status='linked'
 *   (o email=gmail si esa columna existe; en este proyecto profiles NO tiene
 *   columna email dedicada — pending_email es la fuente autoritativa tras vincular,
 *   documentado aquí para no romper tests ni añadir migración innecesaria).
 * - Si en el futuro se añade profiles.email, la query será
 *     WHERE email=gmail OR pending_email=gmail AND link_status='linked'.
 * - Colisión: si pending_email ya existe con link_status='linked', la vinculación falla.
 */

function requireSuperAdminGuard(profile: { role: string | null | undefined } | null): void {
  if (!profile || profile.role !== "super_admin") {
    throw new AuthorizationError("Solo el super_admin puede realizar esta acción.");
  }
}

/**
 * Crea un perfil sin Gmail en estado pending_gmail. Solo super_admin.
 * Usa admin client para bypass RLS. Genera invite_token con crypto.randomUUID().
 */
export async function preRegisterMember(input: PreRegisterMemberInput) {
  const parsed = preRegisterMemberSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  }
  const data = parsed.data;

  let actor: Awaited<ReturnType<typeof getCurrentProfile>>;
  try {
    actor = await getCurrentProfile();
    requireSuperAdminGuard(actor);
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return { success: false as const, error: e.message };
    }
    return { success: false as const, error: "No tienes permisos para realizar esta acción." };
  }

  const admin = createAdminClient();
  const invite_token = crypto.randomUUID();
  const newId = crypto.randomUUID();

  const { data: inserted, error } = await admin
    .from("profiles")
    .insert({
      id: newId,
      first_name: data.first_name,
      last_name: data.last_name,
      birth_date: data.birth_date ?? null,
      component_type: data.component_type,
      workgroup: data.workgroup,
      role: data.role ?? "member",
      is_minor: data.is_minor ?? false,
      link_status: "pending_gmail",
      pre_registered_by: actor!.id,
      invite_token,
      pending_email: data.pending_email ?? null,
      is_active: true,
      status: "active",
      auth_method: "google",
    } as never)
    .select("id, invite_token")
    .single();

  if (error) {
    return { success: false as const, error: `No se pudo pre-registrar: ${error.message}` };
  }

  return { success: true as const, data: inserted as { id: string; invite_token: string | null } };
}

/**
 * Vincula un Gmail a un perfil pending_gmail. Solo super_admin.
 * - Verifica colisión: si el gmail ya está en profiles con link_status linked → error.
 * - Actualiza profiles a linked, limpia invite_token, guarda pending_email si se aporta.
 * - Conserva histórico (no toca payments, formations, attendance, etc.)
 */
export async function linkGmailToProfile(input: LinkGmailInput) {
  const parsed = linkGmailSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false as const, error: parsed.error.issues[0]?.message ?? "Datos no válidos." };
  }
  const { profileId, gmail, invite_token } = parsed.data;

  let actor: Awaited<ReturnType<typeof getCurrentProfile>>;
  try {
    actor = await getCurrentProfile();
    requireSuperAdminGuard(actor);
  } catch (e) {
    if (e instanceof AuthorizationError) {
      return { success: false as const, error: e.message };
    }
    return { success: false as const, error: "No tienes permisos para realizar esta acción." };
  }

  const admin = createAdminClient();

  // Colisión: gmail ya vinculado a otro perfil (pending_email o buscamos en profiles con auth? Simplificamos: profiles con pending_email=gmail o cualquier perfil que ya tenga ese invite_token limpio pero linked y supuestamente email asociado)
  // Como profiles no tiene email columna directa, verificamos colisión en pending_email y en invite_token? Más robusto: buscar cualquier perfil con link_status linked que tenga pending_email = gmail (histórico) o que tenga mismo gmail en auth.users vía admin check opcional.
  // Para MVP: colisión si existe otro perfil con pending_email = gmail y link_status = 'linked'
  const { data: collision } = await admin
    .from("profiles")
    .select("id")
    .eq("pending_email", gmail)
    .eq("link_status", "linked")
    .maybeSingle();

  if (collision) {
    return { success: false as const, error: "El Gmail ya pertenece a otro perfil vinculado." };
  }

  // También colisión si existe otro perfil con invite_token igual y ya vinculado? No aplica.

  // Verificar perfil destino existe y está pending_gmail
  const { data: target, error: fetchError } = await admin
    .from("profiles")
    .select("id, link_status, invite_token")
    .eq("id", profileId)
    .maybeSingle();

  if (fetchError) {
    return { success: false as const, error: `Error al buscar perfil: ${fetchError.message}` };
  }
  if (!target) {
    return { success: false as const, error: "Perfil no encontrado." };
  }
  if ((target as { link_status: string }).link_status !== "pending_gmail") {
    return { success: false as const, error: "El perfil no está pendiente de vinculación." };
  }
  // Si se aporta invite_token, verificar que coincide
  if (invite_token && (target as { invite_token: string | null }).invite_token !== invite_token) {
    return { success: false as const, error: "Token de invitación no válido." };
  }

  // Vinculación LÓGICA: NO se hace UPDATE id = auth.uid() (ver header).
  // Se mantiene el id original para no huérfanar histórico; el Gmail se guarda
  // en pending_email y el login futuro resuelve por
  //   WHERE pending_email=gmail AND link_status='linked'.
  // Si existe columna email, sería WHERE email=gmail OR pending_email=gmail.
  const { error: updateError } = await admin
    .from("profiles")
    .update({
      link_status: "linked",
      invite_token: null,
      pending_email: gmail,
    } as never)
    .eq("id", profileId);

  if (updateError) {
    return { success: false as const, error: `No se pudo vincular: ${updateError.message}` };
  }

  return { success: true as const, data: { id: profileId, gmail } };
}

/**
 * Auto-vinculación por invite_token: cuando el usuario se registra con Gmail usando /invite/<token>
 * Vincula el auth.uid actual al perfil que tiene ese token.
 */
export async function linkByInviteToken(token: string, gmail: string) {
  if (!token || token.length < 8) {
    return { success: false as const, error: "Token no válido." };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false as const, error: "No autenticado." };
  }
  const admin = createAdminClient();
  const { data: target } = await admin.from("profiles").select("id, link_status").eq("invite_token", token).maybeSingle();
  if (!target) {
    return { success: false as const, error: "Token de invitación no válido." };
  }
  if ((target as { link_status: string }).link_status !== "pending_gmail") {
    return { success: false as const, error: "El perfil ya está vinculado." };
  }
  // Colisión check
  const { data: collision } = await admin.from("profiles").select("id").eq("pending_email", gmail).eq("link_status", "linked").maybeSingle();
  if (collision) {
    return { success: false as const, error: "El Gmail ya pertenece a otro perfil." };
  }
  // Vinculación LÓGICA (no UPDATE id): mantiene histórico intacto
  const { error } = await admin
    .from("profiles")
    .update({ link_status: "linked", invite_token: null, pending_email: gmail } as never)
    .eq("id", (target as { id: string }).id);
  if (error) {
    return { success: false as const, error: error.message };
  }
  return { success: true as const };
}
