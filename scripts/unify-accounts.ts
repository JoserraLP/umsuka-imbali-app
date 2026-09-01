/**
 * UMSUKA IMBALI — Unificar / fusionar dos cuentas
 *
 * Caso típico: has importado con `import-members-from-xlsx.ts` y luego ves
 * que "CARLA AGUILAR NIETO" ya existía como cuenta Google (o como emailless
 * creada antes). Quieres quedarte con UNA y migrar todo el historial de la
 * otra.
 *
 * Uso:
 *   npx tsx scripts/unify-accounts.ts --keep carla_aguilar_nieto --duplicate carla_aguilar_nieto_1 --dry-run
 *   npx tsx scripts/unify-accounts.ts --keep carla_aguilar_nieto --duplicate carla_aguilar_nieto_1
 *   npx tsx scripts/unify-accounts.ts --keep "carla.aguilar@gmail.com" --duplicate carla_aguilar_nieto --by-email --dry-run
 *
 * Flags:
 *   --keep <user>        Username o email de la cuenta que SE QUEDA (historial se conserva)
 *   --duplicate <user>   Username o email de la cuenta DUPLICADA (se migrará y luego BORRARÁ)
 *   --by-email           Resolver por email/alias en vez de username (para cuentas Google)
 *   --by-id              Pasar UUIDs directos en vez de usernames
 *   --keep-id <uuid>     Alternativa a --keep
 *   --dup-id <uuid>      Alternativa a --duplicate
 *   --dry-run            Solo muestra qué se movería, sin escribir
 *   --force              No pide confirmación interactiva (útil para CI)
 *   --help
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en .env.local
 *
 * Qué hace (transacción implícita por pasos, con checks):
 *   1. Resuelve keepId y dupId, valida que existen y no son el mismo, que dup no es super_admin
 *   2. Cuenta filas que se moverían en cada tabla FK → profiles (user_id / created_by / member_user_id / etc.)
 *   3. Migrar (UPDATE ... SET user_id = keepId WHERE user_id = dupId) en:
 *      - umsuka.shift_assignments, attendance, rehearsal_attendance, absences,
 *        event_registrations, event_waitlist, event_comments, voting_votes,
 *        workgroup_attendance, member_payments.user_id / registered_by,
 *        legal_guardians.member_user_id / created_by, finances.transactions.created_by,
 *        notifications, user_preferences, dance_positions.member_id,
 *        musician_instruments.user_id, meeting_minutes.uploaded_by, etc.
 *      - Maneja conflictos de UNIQUE (ej. rehearsal_attendance UNIQUE(event_id,user_id,session)):
 *        si keep ya tiene esa fila, se BORRA la fila de duplicate en vez de reasignar.
 *   4. Borra filas huérfanas de email_aliases, password_reset_tokens, etc. de duplicate
 *   5. Elimina el perfil duplicado: auth.admin.deleteUser(dupId) (CASCADE borra umsuka.profiles)
 *      - Alternativa soft: dejar perfil con deleted_at si prefieres auditoría (no implementado aquí)
 *
 * Después de fusionar, el login que queda es el de --keep. Si keep era Google y duplicate
 * era emailless, el usuario seguirá entrando por Google; la contraseña de duplicate ya no sirve.
 *
 * IMPORTANTE: haz backup antes (supabase db dump o snapshot). Este script no tiene undo.
 */

import * as path from "node:path";
import * as readline from "node:readline";
import * as dotenv from "dotenv";

dotenv.config({ path: path.resolve(".env.local") });
dotenv.config({ path: path.resolve(".env") });

type Args = {
  keep?: string;
  duplicate?: string;
  byEmail: boolean;
  byId: boolean;
  keepId?: string;
  dupId?: string;
  dryRun: boolean;
  force: boolean;
  help: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { byEmail: false, byId: false, dryRun: false, force: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keep" && argv[i + 1]) args.keep = argv[++i];
    else if (a === "--duplicate" && argv[i + 1]) args.duplicate = argv[++i];
    else if (a === "--keep-id" && argv[i + 1]) args.keepId = argv[++i];
    else if (a === "--dup-id" && argv[i + 1]) args.dupId = argv[++i];
    else if (a === "--by-email") args.byEmail = true;
    else if (a === "--by-id") args.byId = true;
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--force") args.force = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else console.warn(`[warn] Flag desconocido: ${a}`);
  }
  return args;
}

function printHelp() {
  console.log(`
Uso:
  npx tsx scripts/unify-accounts.ts --keep <user> --duplicate <user> [--dry-run]
  npx tsx scripts/unify-accounts.ts --keep-id <uuid> --dup-id <uuid> [--dry-run]

  --keep <username|email>   Cuenta que SE QUEDA
  --duplicate <username|email> Cuenta duplicada que se MIGRA y BORRA
  --by-email                Resolver por email (para cuentas Google)
  --by-id                   Pasar UUIDs directos
  --keep-id / --dup-id      Pasar UUIDs directos
  --dry-run                 Solo previsualiza
  --force                   No pide confirmación
`);
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans: string = await new Promise((res) => rl.question(question, res));
  rl.close();
  return ans.trim().toLowerCase() === "si" || ans.trim().toLowerCase() === "s" || ans.trim().toLowerCase() === "yes" || ans.trim().toLowerCase() === "y";
}

// Tablas FK que referencian a profiles/auth.users — lista basada en supabase/migrations
// key: tabla, col: columna, onConflict: "update" | "skip-if-exists" | "set-null"
const FK_TABLES: Array<{ schema: string; table: string; col: string; kind: "user_id" | "created_by" | "other"; unique?: string[] }> = [
  // user_id FKs (migrar al keep, con manejo de duplicado UNIQUE)
  { schema: "umsuka", table: "shift_assignments", col: "user_id", kind: "user_id" },
  { schema: "umsuka", table: "attendance", col: "user_id", kind: "user_id" },
  { schema: "umsuka", table: "rehearsal_attendance", col: "user_id", kind: "user_id", unique: ["event_id", "user_id", "session"] },
  { schema: "umsuka", table: "absences", col: "user_id", kind: "user_id" },
  { schema: "umsuka", table: "event_registrations", col: "user_id", kind: "user_id", unique: ["event_id", "user_id"] },
  { schema: "umsuka", table: "event_waitlist", col: "user_id", kind: "user_id", unique: ["event_id", "user_id"] },
  { schema: "umsuka", table: "event_comments", col: "user_id", kind: "user_id" },
  { schema: "umsuka", table: "voting_votes", col: "user_id", kind: "user_id", unique: ["voting_id", "user_id"] },
  { schema: "umsuka", table: "workgroup_attendance", col: "user_id", kind: "user_id" },
  { schema: "umsuka", table: "member_payments", col: "user_id", kind: "user_id" },
  { schema: "umsuka", table: "user_preferences", col: "user_id", kind: "user_id", unique: ["user_id"] },
  { schema: "umsuka", table: "notifications", col: "user_id", kind: "user_id" },
  { schema: "umsuka", table: "questions", col: "user_id", kind: "user_id" },
  { schema: "umsuka", table: "dance_positions", col: "member_id", kind: "other" },
  { schema: "umsuka", table: "musician_instruments", col: "user_id", kind: "user_id" },
  // created_by / member_user_id / registered_by etc. — migrar pero sin unique conflict
  { schema: "umsuka", table: "legal_guardians", col: "member_user_id", kind: "other" },
  { schema: "umsuka", table: "legal_guardians", col: "created_by", kind: "other" },
  { schema: "umsuka", table: "member_payments", col: "registered_by", kind: "other" },
  { schema: "umsuka", table: "transactions", col: "created_by", kind: "other" },
  { schema: "umsuka", table: "meeting_minutes", col: "uploaded_by", kind: "other" },
  { schema: "umsuka", table: "dance_formations", col: "created_by", kind: "other" },
  { schema: "umsuka", table: "email_aliases", col: "profile_id", kind: "other" },
  { schema: "umsuka", table: "password_attempts", col: "profile_id", kind: "other" },
  { schema: "umsuka", table: "password_reset_tokens", col: "profile_id", kind: "other" },
  { schema: "umsuka", table: "profiles", col: "pre_registered_by", kind: "other" },
  // auth.users FKs (creaciones)
  { schema: "umsuka", table: "events", col: "created_by", kind: "other" },
  { schema: "umsuka", table: "shifts", col: "created_by", kind: "other" },
  { schema: "umsuka", table: "news", col: "created_by", kind: "other" },
];

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (!args.keepId && !args.keep) {
    console.error("--keep o --keep-id es obligatorio");
    printHelp();
    process.exit(1);
  }
  if (!args.dupId && !args.duplicate) {
    console.error("--duplicate o --dup-id es obligatorio");
    printHelp();
    process.exit(1);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceKey, {
    db: { schema: "umsuka" },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Resolver IDs
  async function resolveId(input: string, byEmail: boolean): Promise<{ id: string; label: string; profile: Record<string, unknown> | null }> {
    if (args.byId) return { id: input, label: input, profile: null };
    if (byEmail) {
      // Buscar en auth.users por email
      // No hay método directo por email, listar y filtrar (paginado simple)
      // Primero probar profiles.pending_email / email_aliases
      const { data: alias } = await admin.from("email_aliases").select("profile_id, alias_email").eq("alias_email", input).maybeSingle();
      if (alias?.profile_id) {
        const { data: p } = await admin.from("profiles").select("id, username, first_name, last_name, auth_method, role, is_minor").eq("id", alias.profile_id).maybeSingle();
        if (p) return { id: p.id as string, label: `${input} -> ${p.username} (${p.id})`, profile: p as Record<string, unknown> };
      }
      // Buscar en profiles.pending_email
      const { data: p2 } = await admin.from("profiles").select("id, username, first_name, last_name, auth_method, role").eq("pending_email", input).maybeSingle();
      if (p2) return { id: p2.id as string, label: `${input} -> ${p2.username} (${p2.id})`, profile: p2 as Record<string, unknown> };
      // Buscar auth user por email (admin list)
      const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const found = (list?.users as Array<{ id: string; email?: string }> | undefined)?.find((u) => u.email?.toLowerCase() === input.toLowerCase());
      if (found) {
        const { data: p } = await admin.from("profiles").select("id, username, first_name, last_name, auth_method, role").eq("id", found.id).maybeSingle();
        return { id: found.id, label: `${input} -> ${p?.username ?? "?"} (${found.id})`, profile: (p as Record<string, unknown>) ?? null };
      }
      throw new Error(`No se encontró cuenta por email: ${input}`);
    } else {
      const { data: p, error } = await admin.from("profiles").select("id, username, first_name, last_name, auth_method, role, is_minor, status, is_active").eq("username", input).maybeSingle();
      if (error) throw error;
      if (!p) throw new Error(`No se encontró username: ${input}`);
      return { id: p.id as string, label: `${input} (${p.id}) ${p.first_name} ${p.last_name} [${p.auth_method}/${p.role}]`, profile: p as Record<string, unknown> };
    }
  }

  const keepResolved = args.keepId ? { id: args.keepId, label: args.keepId, profile: null } : await resolveId(args.keep!, args.byEmail);
  const dupResolved = args.dupId ? { id: args.dupId, label: args.dupId, profile: null } : await resolveId(args.duplicate!, args.byEmail);

  if (keepResolved.id === dupResolved.id) {
    console.error("keep y duplicate son el mismo id — nada que hacer");
    process.exit(1);
  }

  console.log("\n[unify] Cuenta que SE QUEDA (keep):", keepResolved.label);
  console.log("[unify] Cuenta DUPLICADA (se borrará):", dupResolved.label);
  if (dupResolved.profile && (dupResolved.profile as { role: string }).role === "super_admin") {
    console.error("No se puede borrar un super_admin duplicado por seguridad. Cambia su rol primero.");
    process.exit(1);
  }

  // Contar filas a migrar
  console.log("\n[unify] Analizando filas a migrar...");
  let totalMoves = 0;
  for (const fk of FK_TABLES) {
    const { count, error } = await admin.from(fk.table).select("id", { count: "exact", head: true }).eq(fk.col, dupResolved.id);
    if (error) {
      // Algunas tablas usan PK distinta (ej. user_preferences PK=user_id) — count igual funciona; si falla, ignorar
      // Probar con select sin id
      const { count: c2 } = await admin.from(fk.table).select(fk.col, { count: "exact", head: true }).eq(fk.col, dupResolved.id);
      if (c2 && c2 > 0) {
        console.log(`  ${fk.schema}.${fk.table}.${fk.col}: ${c2} filas`);
        totalMoves += c2;
      }
      continue;
    }
    if (count && count > 0) {
      console.log(`  ${fk.schema}.${fk.table}.${fk.col}: ${count} filas`);
      totalMoves += count;
    }
  }
  if (totalMoves === 0) console.log("  (ninguna fila relacionada — solo se borrará el perfil/alias)");

  if (args.dryRun) {
    console.log("\n[dry-run] No se ha modificado nada. Quita --dry-run para ejecutar.");
    return;
  }

  if (!args.force) {
    const ok = await confirm(`\n¿Confirmas migrar TODO de ${dupResolved.label} hacia ${keepResolved.label} y BORRAR la duplicada? Escribe "si" para continuar: `);
    if (!ok) {
      console.log("Cancelado.");
      process.exit(0);
    }
  }

  // Migrar cada FK
  console.log("\n[unify] Migrando...");
  for (const fk of FK_TABLES) {
    // Para tablas con UNIQUE donde keep ya tiene fila, no podemos UPDATE — borramos la de dup
    if (fk.unique) {
      // Estrategia: si existe conflicto, borrar fila de duplicado; si no, reasignar
      const { data: dupRows, error: dupErr } = await admin.from(fk.table).select("*").eq(fk.col, dupResolved.id);
      if (dupErr || !dupRows || dupRows.length === 0) continue;

      for (const row of dupRows) {
        // Construir where de unicidad para comprobar si keep ya tiene misma combinación
        let conflict = false;
        if (fk.table === "rehearsal_attendance") {
          const { data: existing } = await admin
            .from(fk.table)
            .select("id")
            .eq("user_id", keepResolved.id)
            .eq("event_id", (row as Record<string, unknown>).event_id)
            .eq("session", (row as Record<string, unknown>).session)
            .maybeSingle();
          conflict = !!existing;
        } else if (fk.table === "event_registrations" || fk.table === "event_waitlist") {
          const { data: existing } = await admin.from(fk.table).select("id").eq("user_id", keepResolved.id).eq("event_id", (row as Record<string, unknown>).event_id).maybeSingle();
          conflict = !!existing;
        } else if (fk.table === "voting_votes") {
          const { data: existing } = await admin.from(fk.table).select("id").eq("user_id", keepResolved.id).eq("voting_id", (row as Record<string, unknown>).voting_id).maybeSingle();
          conflict = !!existing;
        } else if (fk.table === "user_preferences") {
          const { data: existing } = await admin.from(fk.table).select("user_id").eq("user_id", keepResolved.id).maybeSingle();
          conflict = !!existing;
        }

        if (conflict) {
          const { error: delErr } = await admin.from(fk.table).delete().eq("id", (row as Record<string, unknown>).id ?? (row as Record<string, unknown>).user_id).eq(fk.col, dupResolved.id);
          // Fallback si PK no es id
          if (delErr) {
            await admin.from(fk.table).delete().eq(fk.col, dupResolved.id).eq("event_id", (row as Record<string, unknown>).event_id);
          }
          console.log(`  [conflicto resuelto] borrado ${fk.table} duplicado para ${dupResolved.id}`);
        } else {
          const { error: updErr } = await admin.from(fk.table).update({ [fk.col]: keepResolved.id }).eq(fk.col, dupResolved.id).eq("id", (row as Record<string, unknown>).id ?? (row as Record<string, unknown>).user_id);
          if (updErr) {
            // Fallback update sin id
            await admin.from(fk.table).update({ [fk.col]: keepResolved.id }).eq(fk.col, dupResolved.id);
          }
        }
      }
    } else {
      const { error } = await admin.from(fk.table).update({ [fk.col]: keepResolved.id }).eq(fk.col, dupResolved.id);
      if (error) {
        // Tabla puede no existir en ese entorno o sin permiso — solo avisar
        if (!error.message.includes("Could not find")) console.warn(`  [warn] ${fk.table}.${fk.col}: ${error.message}`);
      } else {
        // Solo log si hubo filas (ya contado arriba)
      }
    }
  }

  // Limpiar alias / intentos / tokens del duplicado (si quedaron)
  await admin.from("email_aliases").delete().eq("profile_id", dupResolved.id);
  await admin.from("password_attempts").delete().eq("profile_id", dupResolved.id);
  await admin.from("password_reset_tokens").delete().eq("profile_id", dupResolved.id);

  // Borrar perfil + auth user duplicado (CASCADE borra profiles)
  console.log(`\n[unify] Borrando cuenta duplicada ${dupResolved.id}...`);
  const { error: delAuthErr } = await admin.auth.admin.deleteUser(dupResolved.id);
  if (delAuthErr) {
    console.error(`[error] No se pudo borrar auth user: ${delAuthErr.message}`);
    console.log(`Intenta borrar manualmente desde Dashboard → Authentication → Users`);
    // Intentar al menos borrar profile directo
    await admin.from("profiles").delete().eq("id", dupResolved.id);
  } else {
    console.log("[unify] Duplicada borrada correctamente (auth + profile CASCADE).");
  }

  console.log("\n[unify] Hecho. Verifica que el login que queda es:", keepResolved.label);
  console.log("  - Si keep era Google, entra por Google");
  console.log("  - Si keep era emailless, usa su username/password original");
}

main().catch((e) => {
  console.error("[fatal]", e?.message ?? e);
  console.error(e?.stack);
  process.exit(1);
});
