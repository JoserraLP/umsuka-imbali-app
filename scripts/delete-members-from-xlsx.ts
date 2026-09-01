/**
 * UMSUKA IMBALI — Borrar miembros importados desde XLSX
 *
 * Lee el mismo XLSX que `import-members-from-xlsx.ts` y BORRA de la BD
 * todos los perfiles que coinciden con los nombres del listado.
 *
 * Matching por defecto: por `username` generado con la misma lógica
 * (slug de first_name + last_name en CamelCase → lower/underscore).
 * Si el perfil fue creado con el import, el username coincidirá.
 * Fallback opcional: por `first_name`+`last_name` (case-insensitive).
 *
 * Uso:
 *   # 1. Dry-run: ver quién se borraría (no borra)
 *   npx tsx scripts/delete-members-from-xlsx.ts --dry-run
 *   npx tsx scripts/delete-members-from-xlsx.ts --dry-run --file scripts/data/listado-sorteo-2027.xlsx --limit 5
 *
 *   # 2. Borrar de verdad (pide confirmación "si")
 *   npx tsx scripts/delete-members-from-xlsx.ts
 *   npx tsx scripts/delete-members-from-xlsx.ts --force
 *   npx tsx scripts/delete-members-from-xlsx.ts --with-guardians
 *
 * Flags:
 *   --file <ruta>         Ruta al XLSX (default: scripts/data/listado-sorteo-2027.xlsx)
 *   --sheet <nombre>      Hoja (default: primera)
 *   --dry-run             Solo preview, no borra
 *   --limit <n>           Solo primeros n del Excel
 *   --by-name             Buscar por first_name/last_name en vez de username
 *   --with-guardians      Además borra los legal_guardians asociados a esos menores
 *                         (los creados por el import: "Tutor por asignar..." / "Tutor de ...")
 *   --force               No pide confirmación interactiva
 *   --help
 *
 * Requiere: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY en .env.local
 * No hace push/commit. El borrado es PERMANENTE: auth.users + profiles (CASCADE),
 * y deja SET NULL en FKs no-CASCADE (member_payments, legal_guardians creados, etc.).
 *
 * Seguridad: nunca borra super_admin aunque coincida el nombre — lo salta y avisa.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as readline from "node:readline";
import * as dotenv from "dotenv";
import * as ExcelJS from "exceljs";

dotenv.config({ path: path.resolve(".env.local") });
dotenv.config({ path: path.resolve(".env") });

type Args = {
  file: string;
  sheet?: string;
  dryRun: boolean;
  limit?: number;
  byName: boolean;
  withGuardians: boolean;
  force: boolean;
  help: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    file: path.resolve("scripts/data/listado-sorteo-2027.xlsx"),
    dryRun: false,
    byName: false,
    withGuardians: false,
    force: false,
    help: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" && argv[i + 1]) args.file = path.resolve(argv[++i]);
    else if (a === "--sheet" && argv[i + 1]) args.sheet = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--limit" && argv[i + 1]) args.limit = parseInt(argv[++i], 10);
    else if (a === "--by-name") args.byName = true;
    else if (a === "--with-guardians") args.withGuardians = true;
    else if (a === "--force") args.force = true;
    else if (a === "--help" || a === "-h") args.help = true;
    else console.warn(`[warn] Flag desconocido: ${a}`);
  }
  return args;
}

function printHelp() {
  console.log(`
Uso: npx tsx scripts/delete-members-from-xlsx.ts [flags]

  --file <ruta>       XLSX (default scripts/data/listado-sorteo-2027.xlsx)
  --sheet <nombre>    Hoja
  --dry-run           Solo preview, no borra
  --limit <n>         Solo primeros n
  --by-name           Matching por first_name/last_name en vez de username
  --with-guardians    Borra también los legal_guardians de esos menores
  --force             No pide confirmación
  --help
Ejemplos:
  npx tsx scripts/delete-members-from-xlsx.ts --dry-run
  npx tsx scripts/delete-members-from-xlsx.ts --dry-run --by-name
  npx tsx scripts/delete-members-from-xlsx.ts --with-guardians
`);
}

// ── Helpers copiados de import-members (CamelCase) ───────────────

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
      return word
        .split("-")
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
        .join("-")
        .split("'")
        .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
        .join("'");
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
  let s = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/__+/g, "_");
  if (s.length < 3) s = (s + "_user").slice(0, 30);
  if (s.length > 30) s = s.slice(0, 30).replace(/_+$/g, "");
  if (!/^[a-z0-9_]+$/.test(s)) s = s.replace(/[^a-z0-9_]/g, "_");
  if (s.length < 3) s = `user_${s}`.slice(0, 30);
  return s;
}

async function confirm(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ans: string = await new Promise((res) => rl.question(question, res));
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

  if (!fs.existsSync(args.file)) {
    console.error(`[error] No se encontró XLSX: ${args.file}`);
    process.exit(1);
  }

  console.log(`\n[delete-members] Leyendo XLSX: ${args.file}`);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(args.file);
  const ws = args.sheet ? wb.getWorksheet(args.sheet) : wb.worksheets[0];
  if (!ws) {
    console.error(`[error] Hoja no encontrada: ${args.sheet}`);
    process.exit(1);
  }
  console.log(`[delete-members] Hoja: "${ws.name}" (${ws.rowCount} filas)`);

  // ── Parsear miembros del Excel (misma lógica que import) ──────
  type Member = { raw: string; cleaned: string; firstName: string; lastName: string; category: "adulto" | "nino"; username: string; isMinor: boolean; row: number };
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
      if (typeof obj.result === "string" || typeof obj.result === "number") return String(obj.result).trim();
      return String(v).trim();
    }
    return String(v).trim();
  }

  ws.eachRow((row, rowNumber) => {
    const colA = cellToString(row.getCell(1));
    const colAText = colA.trim();
    const upperA = colAText.toUpperCase();
    if (upperA.includes("ADULTOS")) {
      currentCategory = "adulto";
      return;
    }
    if (upperA.includes("NIÑOS") || upperA.includes("NINOS") || upperA.includes("F/CARNVAL") || upperA.includes("F/CARN")) {
      currentCategory = "nino";
      return;
    }
    if (upperA === "TOTALES" || upperA === "TOTAL") return;
    if (upperA.includes("IMPORTES") || upperA === "NC" || upperA.includes("OBSERVACIONES")) return;
    if (!colAText || colAText.length < 3) return;
    const isNameRow = /[A-ZÁÉÍÓÚÑ]/i.test(colAText) && colAText.split(" ").length >= 2;
    if (!isNameRow || /TOTAL/i.test(colAText)) return;
    const cleaned = stripSuffixes(colAText);
    if (!cleaned || cleaned.length < 3) return;
    if (cleaned.toUpperCase() === "TOTALES") return;
    const { firstName, lastName } = parseSpanishFullName(cleaned);
    if (!firstName || !lastName) return;
    const usernameBase = slugifyUsername(firstName, lastName, cleaned);
    members.push({ raw: colAText, cleaned, firstName, lastName, category: currentCategory, username: usernameBase, isMinor: currentCategory === "nino", row: rowNumber });
  });

  // Deduplicar usernames intra-excel igual que el import
  const usernameCounts = new Map<string, number>();
  for (const m of members) {
    let base = m.username.slice(0, 28);
    let candidate = base;
    let n = 1;
    while (usernameCounts.has(candidate)) {
      candidate = `${base.slice(0, 27)}_${n}`.slice(0, 30);
      n++;
      if (n > 99) candidate = `${base.slice(0, 22)}_${Math.random().toString(36).slice(2, 8)}`.slice(0, 30);
    }
    usernameCounts.set(candidate, 1);
    m.username = candidate;
  }

  if (args.limit && args.limit > 0) members.splice(args.limit);

  const adultos = members.filter((m) => m.category === "adulto").length;
  const ninos = members.filter((m) => m.category === "nino").length;
  console.log(`[delete-members] Detectados en XLSX: ${members.length} (${adultos} adultos, ${ninos} niños)`);
  if (args.byName) console.log(`[delete-members] Matching por first_name/last_name (case-insensitive)`);
  else console.log(`[delete-members] Matching por username (slug CamelCase → underscore)`);

  // ── Resolver contra BD ────────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("[error] Falta NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local");
    process.exit(1);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceKey, {
    db: { schema: "umsuka" },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Buscar perfiles existentes
  type Found = { id: string; username: string | null; first_name: string; last_name: string; role: string; is_minor: boolean; legal_guardian_id: string | null; status: string };
  const found: Found[] = [];
  const notFound: Member[] = [];

  if (args.byName) {
    // Búsqueda por nombre: traemos todos y filtramos en memoria (135 → no pesa)
    const { data: allProfiles, error } = await admin.from("profiles").select("id, username, first_name, last_name, role, is_minor, legal_guardian_id, status");
    if (error) {
      console.error(`[error] No se pudo listar profiles: ${error.message}`);
      process.exit(1);
    }
    const norm = (s: string) => s.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    for (const m of members) {
      const hit = (allProfiles as Found[] | null)?.find((p) => norm(p.first_name) === norm(m.firstName) && norm(p.last_name) === norm(m.lastName));
      if (hit) found.push(hit);
      else notFound.push(m);
    }
  } else {
    const usernames = members.map((m) => m.username);
    for (let i = 0; i < usernames.length; i += 100) {
      const chunk = usernames.slice(i, i + 100);
      const { data, error } = await admin.from("profiles").select("id, username, first_name, last_name, role, is_minor, legal_guardian_id, status").in("username", chunk);
      if (error) {
        console.warn(`[warn] chunk ${i}: ${error.message}`);
        continue;
      }
      for (const row of (data as Found[]) ?? []) found.push(row);
    }
    const foundUsernames = new Set(found.map((f) => f.username));
    for (const m of members) if (!foundUsernames.has(m.username)) notFound.push(m);
  }

  console.log(`\n[delete-members] Encontrados en BD para borrar: ${found.length}`);
  console.log(`[delete-members] No encontrados (ya borrados o nunca importados): ${notFound.length}`);

  if (found.length === 0) {
    console.log("\nNada que borrar.");
    if (notFound.length > 0) {
      console.log("Ejemplos no encontrados:");
      for (const m of notFound.slice(0, 5)) console.log(`  - ${m.username} (${m.firstName} ${m.lastName}) raw:"${m.raw}"`);
    }
    return;
  }

  // Filtrar super_admin por seguridad
  const superAdmins = found.filter((f) => f.role === "super_admin");
  if (superAdmins.length > 0) {
    console.warn(`\n[AVISO] ${superAdmins.length} super_admin(s) coinciden y NO se borrarán por seguridad:`);
    for (const s of superAdmins) console.warn(`  - ${s.username} (${s.id}) ${s.first_name} ${s.last_name}`);
  }
  const toDelete = found.filter((f) => f.role !== "super_admin");

  console.log(`\n--- A borrar (${toDelete.length}) ---`);
  for (const f of toDelete.slice(0, 15)) {
    console.log(`  ${String(f.username).padEnd(30)} | ${f.first_name} ${f.last_name} | ${f.id} | role=${f.role} is_minor=${f.is_minor}`);
  }
  if (toDelete.length > 15) console.log(`  ... y ${toDelete.length - 15} más`);

  // Guardianes asociados si --with-guardians
  let guardiansToDelete: Array<{ id: string; full_name: string }> = [];
  if (args.withGuardians) {
    const guardianIds = Array.from(new Set(toDelete.map((f) => f.legal_guardian_id).filter(Boolean as unknown as (v: string | null) => v is string)));
    if (guardianIds.length > 0) {
      const { data: guardians, error } = await admin.from("legal_guardians").select("id, full_name").in("id", guardianIds);
      if (!error && guardians) {
        guardiansToDelete = guardians as Array<{ id: string; full_name: string }>;
        console.log(`\n[guardians] Con --with-guardians se borrarán ${guardiansToDelete.length} legal_guardians asociados:`);
        for (const g of guardiansToDelete) console.log(`  - ${g.id} "${g.full_name}"`);
        // También buscar guardianes huérfanos creados por el import que ya no tengan minors vinculados
        // (ej. "Tutor por asignar — Importación 2027" si todos los niños se borran)
        const { data: orphans } = await admin.from("legal_guardians").select("id, full_name").ilike("full_name", "%Importación 2027%");
        if (orphans && orphans.length > 0) {
          const extra = (orphans as Array<{ id: string; full_name: string }>).filter((o) => !guardianIds.includes(o.id));
          if (extra.length > 0) {
            console.log(`[guardians] Además se detectaron ${extra.length} guardianes huérfanos de la importación:`);
            for (const e of extra) console.log(`  - ${e.id} "${e.full_name}"`);
            // Preguntar si incluirlos: por ahora solo avisar, no borrar automático salvo que estén en guardianIds
            // Si quieres borrarlos, añade lógica: guardiansToDelete.push(...extra)
          }
        }
      }
    } else {
      console.log(`\n[guardians] --with-guardians activo pero ninguno de los perfiles tiene legal_guardian_id.`);
    }
  }

  // ── Dry-run: CSV preview ─────────────────────────────────────
  if (args.dryRun) {
    const ts = new Date().toISOString().slice(0, 10);
    const outPath = path.resolve(`scripts/data/delete-preview-${ts}.csv`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    const header = "username,first_name,last_name,id,role,is_minor,legal_guardian_id,status,action\n";
    const rows = toDelete.map((f) => `${f.username},"${f.first_name}","${f.last_name}",${f.id},${f.role},${f.is_minor},${f.legal_guardian_id ?? ""},${f.status},DELETE`).join("\n");
    fs.writeFileSync(outPath, header + rows, "utf8");
    console.log(`\n[dry-run] CSV preview: ${outPath}`);
    console.log(`[dry-run] No se ha borrado nada. Quita --dry-run para borrar de verdad.`);
    return;
  }

  // ── Confirmación ─────────────────────────────────────────────
  if (!args.force) {
    const ok = await confirm(`\n¿Borrar PERMANENTEMENTE ${toDelete.length} perfiles (${toDelete.filter((f) => f.is_minor).length} menores)${args.withGuardians ? ` y ${guardiansToDelete.length} guardianes` : ""}? Escribe "si" para confirmar: `);
    if (!ok) {
      console.log("Cancelado.");
      process.exit(0);
    }
  }

  // ── Borrado ──────────────────────────────────────────────────
  console.log(`\n[delete-members] Borrando ${toDelete.length} perfiles...`);
  let ok = 0;
  let fail = 0;
  for (const f of toDelete) {
    // auth.admin.deleteUser hace CASCADE en profiles + email_aliases, y SET NULL en otras FKs
    const { error } = await admin.auth.admin.deleteUser(f.id);
    if (error) {
      console.error(`[error] ${f.username} (${f.id}): ${error.message}`);
      // Fallback: intentar borrar solo el profile (si no tiene auth user, ej. pre-registrado)
      const { error: pErr } = await admin.from("profiles").delete().eq("id", f.id);
      if (pErr) {
        console.error(`  fallback profiles.delete también falló: ${pErr.message}`);
        fail++;
      } else {
        console.log(`[ok] ${f.username} — profile borrado (sin auth user)`);
        ok++;
      }
      fail++;
    } else {
      console.log(`[ok] ${f.username} (${f.id}) borrado`);
      ok++;
    }
  }

  if (args.withGuardians && guardiansToDelete.length > 0) {
    console.log(`\n[guardians] Borrando ${guardiansToDelete.length} guardianes...`);
    for (const g of guardiansToDelete) {
      // Verificar que ya no quedan minors vinculados antes de borrar
      const { count } = await admin.from("profiles").select("id", { count: "exact", head: true }).eq("legal_guardian_id", g.id);
      if (count && count > 0) {
        console.warn(`[warn] Guardián ${g.id} aún tiene ${count} menores vinculados — se desvincularán (SET NULL) al borrar, pero revisa.`);
      }
      const { error } = await admin.from("legal_guardians").delete().eq("id", g.id);
      if (error) console.error(`[error] guardián ${g.id}: ${error.message}`);
      else console.log(`[ok] guardián ${g.id} "${g.full_name}" borrado`);
    }
  }

  // CSV de resultado
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = path.resolve(`scripts/data/delete-result-${ts}.csv`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const header = "username,first_name,last_name,id,role,action,error\n";
  // Para reporte simple, solo listamos los borrados
  const rows = toDelete.map((f) => `${f.username},"${f.first_name}","${f.last_name}",${f.id},${f.role},DELETE,`).join("\n");
  fs.writeFileSync(outPath, header + rows, "utf8");

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`[resumen] Borrados: ${ok} | Fallos: ${fail} | No encontrados: ${notFound.length} | Saltados super_admin: ${superAdmins.length}`);
  console.log(`[resumen] CSV resultado: ${outPath}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[fatal]", e?.message ?? e);
  console.error(e?.stack);
  process.exit(1);
});
