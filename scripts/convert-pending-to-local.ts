/**
 * UMSUKA IMBALI — Convertir pendientes de Gmail a cuenta local (bulk)
 *
 * Para el super_admin: convierte perfiles pending_gmail (creados con --pending-gmail)
 * a cuenta local email_alias (usuario/contraseña). El histórico se conserva.
 *
 * Uso:
 *   # Preview qué pendientes se convertirían (del XLSX)
 *   npx tsx scripts/convert-pending-to-local.ts --dry-run
 *   npx tsx scripts/convert-pending-to-local.ts --dry-run --file scripts/data/listado-sorteo-2027.xlsx
 *
 *   # Convertir todos los pendientes que coinciden con el XLSX
 *   npx tsx scripts/convert-pending-to-local.ts
 *   npx tsx scripts/convert-pending-to-local.ts --default-password 'Umsuka2026!'
 *
 *   # Convertir todos los pending_gmail de la BD (sin filtrar por XLSX)
 *   npx tsx scripts/convert-pending-to-local.ts --all-pending --dry-run
 *   npx tsx scripts/convert-pending-to-local.ts --all-pending
 *
 *   # Convertir un perfil concreto por id o username
 *   npx tsx scripts/convert-pending-to-local.ts --profile-id <uuid> --username carla_local --password 'Aa1!xxxx'
 *
 * Flags:
 *   --file <ruta>          XLSX para filtrar (default scripts/data/listado-sorteo-2027.xlsx)
 *   --sheet <nombre>       Hoja
 *   --dry-run              Solo preview
 *   --all-pending          Ignora XLSX, convierte todos los pending_gmail
 *   --profile-id <uuid>    Convierte solo ese perfil
 *   --username <name>      Username a usar (solo con --profile-id)
 *   --password <pwd>       Password a usar (solo con --profile-id, debe cumplir schema)
 *   --default-password <pwd> Password fija para todos (bulk)
 *   --force                No pide confirmación
 *   --help
 *
 * Requiere NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import * as dotenv from "dotenv";
import * as ExcelJS from "exceljs";
import { randomUUID } from "crypto";

dotenv.config({ path: path.resolve(".env.local") });
dotenv.config({ path: path.resolve(".env") });

type Args = {
  file: string;
  sheet?: string;
  dryRun: boolean;
  allPending: boolean;
  profileId?: string;
  username?: string;
  password?: string;
  defaultPassword?: string;
  force: boolean;
  help: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    file: path.resolve("scripts/data/listado-sorteo-2027.xlsx"),
    dryRun: false,
    allPending: false,
    force: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" && argv[i + 1]) args.file = path.resolve(argv[++i]);
    else if (a === "--sheet" && argv[i + 1]) args.sheet = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--all-pending") args.allPending = true;
    else if (a === "--profile-id" && argv[i + 1]) args.profileId = argv[++i];
    else if (a === "--username" && argv[i + 1]) args.username = argv[++i];
    else if (a === "--password" && argv[i + 1]) args.password = argv[++i];
    else if (a === "--default-password" && argv[i + 1]) args.defaultPassword = argv[++i];
    else if (a === "--force") args.force = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else console.warn(`[warn] Flag desconocido: ${a}`);
  }
  return args;
}

function printHelp() {
  console.log(`
Uso:
  npx tsx scripts/convert-pending-to-local.ts --dry-run
  npx tsx scripts/convert-pending-to-local.ts --all-pending --dry-run
  npx tsx scripts/convert-pending-to-local.ts --profile-id <uuid> --username <u> --password <p>

Flags:
  --file <ruta>          XLSX (default listado-sorteo-2027.xlsx)
  --all-pending          Convierte todos los pending_gmail
  --profile-id <uuid>    Solo ese perfil
  --username <u>         Username para --profile-id
  --password <p>         Password para --profile-id
  --default-password <p> Password fija para bulk
  --dry-run              Solo preview
  --force                Sin confirmación
`);
}

// ── Helpers CamelCase (copiado de import) ──
function stripSuffixes(raw: string): string {
  let s = raw.trim();
  s = s.replace(/�/g, "Ñ").replace(/�/g, "ñ");
  s = s.replace(/,/g, " ");
  s = s.replace(/\s*-\s*(NUEVO|NUEVA|V\.EXC.*|V\.EXC\.?|V\.EXC EN JUNIO.*|NUEVO PTE.*|NUEVA PTE.*)\s*$/i, "");
  s = s.replace(/\s*-\s*$/, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}
const LOWER_PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "do", "dos", "das"]);
function toTitleCase(input: string): string {
  return input
    .toLowerCase()
    .split(" ")
    .map((word, idx) => {
      if (!word) return word;
      if (idx !== 0 && LOWER_PARTICLES.has(word)) return word;
      return word.split("-").map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p)).join("-")
        .split("'").map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p)).join("'");
    })
    .join(" ");
}
const DOUBLE_NAME_START = new Set(["MARIA", "MARÍA", "JOSE", "JOSÉ", "JUAN", "ANA", "LUIS", "CARLOS", "FRANCISCO", "FRANCISCA", "ANTONIO", "M"]);
function parseSpanishFullName(cleaned: string): { firstName: string; lastName: string } {
  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length === 0) return { firstName: "", lastName: "" };
  if (tokens.length === 1) return { firstName: toTitleCase(tokens[0]), lastName: "-" };
  if (tokens.length === 2) return { firstName: toTitleCase(tokens[1]), lastName: toTitleCase(tokens[0]) };
  const last = tokens[tokens.length - 1];
  const penult = tokens[tokens.length - 2];
  if (DOUBLE_NAME_START.has(penult.toUpperCase())) {
    return { firstName: toTitleCase(tokens.slice(-2).join(" ")), lastName: toTitleCase(tokens.slice(0, -2).join(" ")) || "-" };
  }
  return { firstName: toTitleCase(last), lastName: toTitleCase(tokens.slice(0, -1).join(" ")) };
}
function slugifyUsername(firstName: string, lastName: string, fallback: string): string {
  const raw = `${firstName} ${lastName}`.trim() || fallback;
  let s = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/ñ/g, "n").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/__+/g, "_");
  if (s.length < 3) s = (s + "_user").slice(0, 30);
  if (s.length > 30) s = s.slice(0, 30).replace(/_+$/g, "");
  if (!/^[a-z0-9_]+$/.test(s)) s = s.replace(/[^a-z0-9_]/g, "_");
  if (s.length < 3) s = `user_${s}`.slice(0, 30);
  return s;
}
function generateSecurePassword(): string {
  const lowers = "abcdefghijklmnopqrstuvwxyz";
  const uppers = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const specials = "!@#$%*_-+?";
  const all = lowers + uppers + digits + specials;
  const pick = (str: string) => str[Math.floor(Math.random() * str.length)];
  let pwd = pick(uppers) + pick(lowers) + pick(digits) + pick(specials);
  const len = 12 + Math.floor(Math.random() * 4);
  for (let i = pwd.length; i < len; i++) pwd += pick(all);
  return pwd.split("").sort(() => Math.random() - 0.5).join("");
}
function validatePasswordOrExit(pwd: string) {
  const checks: [RegExp, string][] = [[/.{8,}/, "mínimo 8"], [/[A-Z]/, "mayúscula"], [/[a-z]/, "minúscula"], [/[0-9]/, "número"], [/[^a-zA-Z0-9]/, "especial"]];
  const fails = checks.filter(([re]) => !re.test(pwd)).map(([, m]) => m);
  if (fails.length) {
    console.error(`[error] Password no cumple: falta ${fails.join(", ")}`);
    process.exit(1);
  }
}
async function confirm(q: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans: string = await new Promise((res) => rl.question(q, res));
  rl.close();
  const v = ans.trim().toLowerCase();
  return v === "si" || v === "s" || v === "yes" || v === "y";
}

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    process.exit(0);
  }
  if (args.defaultPassword) validatePasswordOrExit(args.defaultPassword);
  if (args.password) validatePasswordOrExit(args.password);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  if (!url || !key) {
    console.error("Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
    process.exit(1);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(url, key, { db: { schema: "umsuka" }, auth: { autoRefreshToken: false, persistSession: false } });

  // Resolver actor super_admin para created_by de email_aliases
  let createdBy: string | null = null;
  {
    const { data } = await admin.from("profiles").select("id").eq("role", "super_admin").limit(1);
    if (data && data.length > 0) createdBy = (data[0] as { id: string }).id;
    else {
      const { data: d2 } = await admin.from("profiles").select("id").in("role", ["super_admin", "admin"]).limit(1);
      if (d2 && d2.length > 0) createdBy = (d2[0] as { id: string }).id;
    }
  }
  if (!createdBy) {
    console.error("No se encontró super_admin para created_by");
    process.exit(1);
  }

  type Target = { id: string; first_name: string; last_name: string; link_status: string; auth_method: string; username: string | null };
  let targets: Target[] = [];

  if (args.profileId) {
    const { data, error } = await admin.from("profiles").select("id, first_name, last_name, link_status, auth_method, username").eq("id", args.profileId).maybeSingle();
    if (error || !data) {
      console.error(`No se encontró perfil ${args.profileId}: ${error?.message}`);
      process.exit(1);
    }
    targets = [data as Target];
  } else if (args.allPending) {
    const { data, error } = await admin.from("profiles").select("id, first_name, last_name, link_status, auth_method, username").eq("link_status", "pending_gmail").limit(500);
    if (error) {
      console.error(error.message);
      process.exit(1);
    }
    targets = (data as Target[]) ?? [];
    console.log(`[convert] Encontrados ${targets.length} pendientes en total`);
  } else {
    // Filtrar por XLSX
    if (!fs.existsSync(args.file)) {
      console.error(`No se encontró XLSX: ${args.file}`);
      process.exit(1);
    }
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(args.file);
    const ws = args.sheet ? wb.getWorksheet(args.sheet) : wb.worksheets[0];
    if (!ws) {
      console.error(`Hoja no encontrada`);
      process.exit(1);
    }
    type Member = { firstName: string; lastName: string; username: string };
    const members: Member[] = [];
    let currentCategory: "adulto" | "nino" = "adulto";
    function cellToString(cell: ExcelJS.Cell): string {
      const v: unknown = cell.value;
      if (v == null) return "";
      if (typeof v === "string") return v.trim();
      if (typeof v === "number") return String(v).trim();
      if (typeof v === "object") {
        const obj = v as Record<string, unknown>;
        if (Array.isArray(obj.richText)) return (obj.richText as Array<{ text: string }>).map((r) => r.text).join("").trim();
        if (typeof obj.text === "string") return (obj.text as string).trim();
        return String(v).trim();
      }
      return String(v).trim();
    }
    ws.eachRow((row) => {
      const colA = cellToString(row.getCell(1));
      const upperA = colA.toUpperCase();
      if (upperA.includes("ADULTOS")) { currentCategory = "adulto"; return; }
      if (upperA.includes("NIÑOS") || upperA.includes("NINOS") || upperA.includes("F/CARN")) { currentCategory = "nino"; return; }
      if (upperA === "TOTALES" || upperA.includes("IMPORTES") || upperA === "NC" || !colA || colA.length < 3) return;
      if (!/[A-ZÁÉÍÓÚÑ]/i.test(colA) || colA.split(" ").length < 2 || /TOTAL/i.test(colA)) return;
      const cleaned = stripSuffixes(colA);
      if (!cleaned) return;
      const { firstName, lastName } = parseSpanishFullName(cleaned);
      if (!firstName || !lastName) return;
      const username = slugifyUsername(firstName, lastName, cleaned);
      members.push({ firstName, lastName, username });
    });
    // Dedup intra-excel
    const counts = new Map<string, number>();
    for (const m of members) {
      let base = m.username.slice(0, 28);
      let cand = base;
      let n = 1;
      while (counts.has(cand)) { cand = `${base.slice(0, 27)}_${n}`.slice(0, 30); n++; }
      counts.set(cand, 1);
      m.username = cand;
    }
    console.log(`[convert] XLSX: ${members.length} nombres, buscando pendientes que coincidan...`);
    // Buscar pendientes por nombre (case-insensitive)
    const { data: allPending } = await admin.from("profiles").select("id, first_name, last_name, link_status, auth_method, username").eq("link_status", "pending_gmail");
    const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    for (const m of members) {
      const hit = (allPending as Target[] | null)?.find((p) => norm(p.first_name) === norm(m.firstName) && norm(p.last_name) === norm(m.lastName));
      if (hit) targets.push(hit);
    }
    console.log(`[convert] Coincidencias pendientes en XLSX: ${targets.length}`);
  }

  if (targets.length === 0) {
    console.log("Nada que convertir.");
    process.exit(0);
  }

  // Filtrar solo pending_gmail
  const pendings = targets.filter((t) => t.link_status === "pending_gmail");
  const notPending = targets.filter((t) => t.link_status !== "pending_gmail");
  if (notPending.length > 0) {
    console.warn(`[warn] ${notPending.length} no están pending_gmail y se saltarán:`);
    for (const p of notPending) console.warn(`  - ${p.first_name} ${p.last_name} (${p.id}) status=${p.link_status} auth=${p.auth_method}`);
  }
  if (pendings.length === 0) {
    console.log("Ningún pendiente para convertir.");
    process.exit(0);
  }

  // Generar credenciales
  type Plan = { target: Target; username: string; password: string; aliasEmail: string };
  const plans: Plan[] = [];
  const usedUsernames = new Set<string>();
  // Cargar usernames existentes para evitar colisión
  const { data: existingUsers } = await admin.from("profiles").select("username").not("username", "is", null);
  const existingSet = new Set((existingUsers as Array<{ username: string }> | null)?.map((r) => r.username) ?? []);

  for (const t of pendings) {
    let username: string;
    let password: string;
    if (args.profileId && args.username) {
      username = args.username;
      password = args.password ?? generateSecurePassword();
    } else {
      // Generar desde nombre
      const fallback = `${t.first_name} ${t.last_name}`;
      let base = slugifyUsername(t.first_name, t.last_name, fallback);
      // Evitar colisión con existentes y con planes previos
      let cand = base;
      let n = 1;
      while (existingSet.has(cand) || usedUsernames.has(cand)) {
        cand = `${base.slice(0, 27)}_${n}`.slice(0, 30);
        n++;
      }
      username = cand;
      password = args.defaultPassword ?? generateSecurePassword();
    }
    if (existingSet.has(username) || usedUsernames.has(username)) {
      console.error(`[error] Username duplicado ${username} para ${t.first_name} ${t.last_name} — saltando`);
      continue;
    }
    usedUsernames.add(username);
    const aliasEmail = `user-${randomUUID()}@umsuka.internal`;
    plans.push({ target: t, username, password, aliasEmail });
  }

  console.log(`\n--- Preview conversión (${plans.length}) ---`);
  for (const p of plans.slice(0, 10)) {
    console.log(`  ${p.target.first_name} ${p.target.last_name} (${p.target.id}) → ${p.username} / ${p.password} → ${p.aliasEmail}`);
  }
  if (plans.length > 10) console.log(`  ... y ${plans.length - 10} más`);

  if (args.dryRun) {
    const outPath = path.resolve(`scripts/data/convert-preview-${new Date().toISOString().slice(0, 10)}.csv`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const header = "profile_id,first_name,last_name,username,password,alias_email,link_status_from,link_status_to\n";
    const rows = plans.map((p) => `${p.target.id},"${p.target.first_name}","${p.target.last_name}",${p.username},${p.password},${p.aliasEmail},pending_gmail,linked`).join("\n");
    fs.writeFileSync(outPath, header + rows, "utf8");
    console.log(`\n[dry-run] CSV preview: ${outPath}`);
    console.log("[dry-run] No se ha convertido nada. Quita --dry-run para ejecutar.");
    return;
  }

  if (!args.force) {
    const ok = await confirm(`\n¿Convertir ${plans.length} pendientes a cuenta local? Escribe "si": `);
    if (!ok) {
      console.log("Cancelado.");
      process.exit(0);
    }
  }

  let ok = 0;
  let fail = 0;
  const results: Array<{ plan: Plan; success: boolean; error?: string }> = [];

  for (const p of plans) {
    // 1. Actualizar auth.users
    const { error: authErr } = await admin.auth.admin.updateUserById(p.target.id, {
      email: p.aliasEmail,
      password: p.password,
      email_confirm: true,
      user_metadata: { username: p.username, auth_method: "email_alias" },
    } as never);
    if (authErr) {
      console.error(`[error] ${p.target.first_name} ${p.target.last_name}: auth update ${authErr.message}`);
      results.push({ plan: p, success: false, error: authErr.message });
      fail++;
      continue;
    }
    // 2. Actualizar profiles
    const { error: profErr } = await admin
      .from("profiles")
      .update({
        username: p.username,
        auth_method: "email_alias",
        link_status: "linked",
        invite_token: null,
        pending_email: null,
      } as never)
      .eq("id", p.target.id);
    if (profErr) {
      console.error(`[error] ${p.target.first_name}: profile update ${profErr.message}`);
      results.push({ plan: p, success: false, error: profErr.message });
      fail++;
      continue;
    }
    // 3. Insertar email_aliases
    const { error: aliasErr } = await admin.from("email_aliases").insert({
      profile_id: p.target.id,
      alias_email: p.aliasEmail,
      created_by: createdBy,
    } as never);
    if (aliasErr) {
      console.error(`[error] ${p.target.first_name}: alias insert ${aliasErr.message}`);
      results.push({ plan: p, success: false, error: aliasErr.message });
      fail++;
      continue;
    }
    console.log(`[ok] ${p.target.first_name} ${p.target.last_name} → ${p.username}`);
    results.push({ plan: p, success: true });
    ok++;
  }

  const outPath = path.resolve(`scripts/data/convert-result-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}.csv`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const header = "profile_id,first_name,last_name,username,password,alias_email,status,error\n";
  const rows = results.map((r) => `${r.plan.target.id},"${r.plan.target.first_name}","${r.plan.target.last_name}",${r.plan.username},${r.plan.password},${r.plan.aliasEmail},${r.success ? "ok" : "error"},"${r.error ?? ""}"`).join("\n");
  fs.writeFileSync(outPath, header + rows, "utf8");

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`[resumen] Convertidos: ${ok} | Fallos: ${fail} | Total: ${plans.length}`);
  console.log(`[resumen] CSV: ${outPath}`);
  if (ok > 0) console.log("\nAhora entran por /auth/login con usuario/contraseña. Super_admin puede resetear password después.");
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[fatal]", e?.message ?? e);
  console.error(e?.stack);
  process.exit(1);
});
