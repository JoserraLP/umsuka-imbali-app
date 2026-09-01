/**
 * UMSUKA IMBALI — Importación masiva de miembros desde XLSX
 *
 * Crea cuentas "emailless" (sin correo) para cada fila del listado de la comparsa.
 * Usa el mismo flujo que `src/lib/auth/admin-create.ts`:
 *   1. auth.admin.createUser() con alias interno user-{uuid}@umsuka.internal
 *   2. rpc("create_emailless_profile") SECURITY DEFINER → profiles + email_aliases
 *
 * Origen XLSX: scripts/data/listado-sorteo-2027.xlsx (sheet "LISTADO PAPELETAS")
 *   - Sección ADULTOS (≈125) y NIÑOS DE 5 A 11 AÑOS F/CARNVAL (≈10)
 *   - Col A = nombre completo en formato "APELLIDOS NOMBRE" (puede traer sufijos
 *     como "-NUEVO", "-NUEVA", "-V.EXC", "-V.EXC FUE EXC.CARV. 2024", etc.)
 *   - Col B = NC (=1 por miembro). Filas "TOTALES" y vacías se ignoran.
 *
 * Generación automática:
 *   - username: slug del nombre (solo [a-z0-9_], 3-30 chars, único). Ej: "carla_aguilar_nieto"
 *   - password: aleatoria segura que cumple passwordStrengthSchema (8+, may, min, dígito, especial)
 *   - first_name / last_name: heurística para "APELLIDOS NOMBRE" → firstName = nombre(s), lastName = apellidos
 *   - component_type = "member" por defecto (compatible con workgroup "ninguno")
 *   - workgroup = "ninguno" por defecto (no requiere onboarding inmediato; cambiar luego si es music/dance)
 *   - is_minor: true para la sección NIÑOS, false para ADULTOS
 *   - legales: para NIÑOS se crea un representante vacío en `legal_guardians`
 *     (full_name="Tutor por asignar — Importación 2027", is_member=false) y se
 *     vincula vía `profiles.legal_guardian_id`. Luego la directiva lo reasigna
 *     a un adulto real con: `update legal_guardians set is_member=true,
 *     member_user_id=<adult_uuid> where id=<guardian_uuid>`. Ver flags de guardián.
 *
 * Uso:
 *   # 1. Instalar deps (solo primera vez)
 *   npm install --save-dev exceljs dotenv tsx
 *
 *   # 2. Configurar env (necesita service_role — NUNCA exponer al cliente)
 *   # .env.local debe contener:
 *   #   NEXT_PUBLIC_SUPABASE_URL=...
 *   #   SUPABASE_SERVICE_ROLE_KEY=...
 *   #   (opcional) NEXT_PUBLIC_SUPABASE_ANON_KEY=...
 *
 *   # 3. Dry-run (no escribe en BD, solo muestra lo que haría + genera CSV de previsualización)
 *   npx tsx scripts/import-members-from-xlsx.ts --dry-run
 *   npx tsx scripts/import-members-from-xlsx.ts --dry-run --file scripts/data/listado-sorteo-2027.xlsx --limit 5
 *
 *   # 4. Importación real (requiere service_role)
 *   npx tsx scripts/import-members-from-xlsx.ts --active
 *   npx tsx scripts/import-members-from-xlsx.ts --active --default-password 'Umsuka2026!'
 *
 *   # Flags:
 *   --file <ruta>               Ruta al XLSX (default: scripts/data/listado-sorteo-2027.xlsx)
 *   --sheet <nombre>            Nombre de la hoja (default: LISTADO PAPELETAS, o primera hoja)
 *   --dry-run                   No toca Supabase, solo genera CSV de previsualización
 *   --limit <n>                 Procesa solo los primeros n miembros (útil para pruebas)
 *   --default-password <pwd>    Usa esta contraseña para TODOS (debe cumplir el schema). Si no, genera una por usuario.
 *   --component-type <t>        Fuerza component_type (music|dance|member, default member)
 *   --workgroup <w>             Fuerza workgroup (telas|barra|estandarte|limpieza|ninguno, default ninguno)
 *   --active                    Crea con status='active' (p_status='active'). Default es pending si no se pasa.
 *   --output <ruta>             Ruta CSV de salida (default: scripts/data/credenciales-<timestamp>.csv)
 *   --no-guardian               No crear representante para NIÑOS (deja is_minor sin legal_guardian_id)
 *   --guardian-mode <mode>      shared|per-child  (default shared: 1 guardián para todos los niños)
 *   --guardian-name <nombre>    Nombre del guardián placeholder (default "Tutor por asignar — Importación 2027")
 *   --guardian-member <user>    Vincula el/los guardian(es) a un perfil adulto creado (is_member=true,
 *                               member_user_id=<uuid de username>). Ej: --guardian-member carla_aguilar_nieto
 *                               Útil para "cuenta vacía que ya se asociará a uno de los perfiles creados".
 *   --help                      Muestra ayuda
 *
 * Salida:
 *   - En dry-run: scripts/data/preview-*.csv (con username/password/firstName/lastName) para revisión
 *   - En real: scripts/data/credenciales-*.csv + log por consola + resumen de fallos
 *   - IMPORTANTE: el CSV de credenciales contiene contraseñas en claro — NO subir a git, borrar tras entregar.
 *     Añade `scripts/data/credenciales-*.csv` y `scripts/data/preview-*.csv` a .gitignore si no están.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { randomUUID } from "node:crypto";
import * as dotenv from "dotenv";
import ExcelJS from "exceljs";

// Cargar .env.local / .env si existe
try {
  dotenv.config({ path: path.resolve(".env.local") });
  dotenv.config({ path: path.resolve(".env") });
} catch {
  // dotenv no instalado — se asume que las env ya están en el proceso
}

type Args = {
  file: string;
  sheet?: string;
  dryRun: boolean;
  limit?: number;
  defaultPassword?: string;
  componentType: "music" | "dance" | "member";
  workgroup: string;
  active: boolean;
  output?: string;
  help: boolean;
  noGuardian: boolean;
  guardianMode: "shared" | "per-child";
  guardianName: string;
  guardianMember?: string;
  pendingGmail: boolean;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    file: path.resolve("scripts/data/listado-sorteo-2027.xlsx"),
    dryRun: false,
    componentType: "member",
    workgroup: "ninguno",
    active: false,
    help: false,
    noGuardian: false,
    guardianMode: "shared",
    guardianName: "Tutor por asignar \u2014 Importaci\u00f3n 2027",
    pendingGmail: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--file" && argv[i + 1]) args.file = path.resolve(argv[++i]);
    else if (a === "--sheet" && argv[i + 1]) args.sheet = argv[++i];
    else if (a === "--dry-run") args.dryRun = true;
    else if (a === "--limit" && argv[i + 1]) args.limit = parseInt(argv[++i], 10);
    else if (a === "--default-password" && argv[i + 1]) args.defaultPassword = argv[++i];
    else if (a === "--component-type" && argv[i + 1]) {
      const v = argv[++i] as Args["componentType"];
      if (!["music", "dance", "member"].includes(v)) {
        console.error(`--component-type debe ser music|dance|member (recibido: ${v})`);
        process.exit(1);
      }
      args.componentType = v;
    } else if (a === "--workgroup" && argv[i + 1]) args.workgroup = argv[++i];
    else if (a === "--active") args.active = true;
    else if (a === "--output" && argv[i + 1]) args.output = path.resolve(argv[++i]);
    else if (a === "--no-guardian") args.noGuardian = true;
    else if (a === "--guardian-mode" && argv[i + 1]) {
      const v = argv[++i] as Args["guardianMode"];
      if (!["shared", "per-child"].includes(v)) {
        console.error(`--guardian-mode debe ser shared|per-child (recibido: ${v})`);
        process.exit(1);
      }
      args.guardianMode = v;
    } else if (a === "--guardian-name" && argv[i + 1]) args.guardianName = argv[++i];
    else if (a === "--guardian-member" && argv[i + 1]) args.guardianMember = argv[++i];
    else if (a === "--pending-gmail" || a === "--as-pending" || a === "--pending") args.pendingGmail = true;
    else if (a === "--as-email-alias") args.pendingGmail = false;
    else if (a === "--help" || a === "-h") args.help = true;
    else {
      console.warn(`[warn] Flag desconocido ignorado: ${a}`);
    }
  }
  return args;
}

function printHelp() {
  console.log(`
Uso: npx tsx scripts/import-members-from-xlsx.ts [flags]

Flags:
  --file <ruta>               Ruta al XLSX (default: scripts/data/listado-sorteo-2027.xlsx)
  --sheet <nombre>            Nombre de la hoja (default: primera hoja)
  --dry-run                   No escribe en BD, solo genera CSV de previsualización
  --limit <n>                 Procesa solo n miembros
  --default-password <pwd>    Contraseña fija para todos (debe cumplir schema) — solo modo email_alias
  --component-type <t>        music|dance|member (default member)
  --workgroup <w>             telas|barra|estandarte|limpieza|ninguno (default ninguno)
  --active                    Crea con status='active' (default pending) — solo email_alias
  --output <ruta>             CSV de salida
  --no-guardian               No crear representante para NIÑOS
  --guardian-mode <mode>      shared|per-child (default shared)
  --guardian-name <nombre>    Nombre del guardián placeholder
  --guardian-member <user>    Vincula guardián a un adulto existente/creado (is_member=true)
  --pending-gmail             Importa como PRE-REGISTRO (link_status=pending_gmail, sin usuario/contraseña)
                              Queda pendiente y el superadmin lo vincula a Gmail después en /admin/members
                              Genera invite_token (/invite/<token>). Requiere --as-pending.
                              Por defecto es --as-email-alias (cuenta local con username/password).
  --as-email-alias            Fuerza modo cuenta local (default)
  --help                      Esta ayuda

Modos:
  email_alias (default):  Crea auth user + profile (auth_method=email_alias, link_status=linked)
                          Login por username/password. Superadmin puede resetear password pero no vincular Gmail.
  pending_gmail (--pending-gmail):
                          Crea solo profile (auth_method=google, link_status=pending_gmail, invite_token)
                          Sin credenciales. Aparece como "Pendiente de Gmail".
                          Superadmin vincula después en /admin/members con LinkGmailDialog o /invite/<token>.
                          El histórico (pagos, asistencia) se conserva al vincular (misma PK).

Ejemplos:
  # Cuenta local (default) — dry-run
  npx tsx scripts/import-members-from-xlsx.ts --dry-run

  # Pre-registro pendiente de Gmail — ideal si quieres que cada uno vincule su Gmail luego
  npx tsx scripts/import-members-from-xlsx.ts --dry-run --pending-gmail
  npx tsx scripts/import-members-from-xlsx.ts --pending-gmail  # real

  # Guardianes con pendiente
  npx tsx scripts/import-members-from-xlsx.ts --dry-run --pending-gmail --guardian-mode per-child
  npx tsx scripts/import-members-from-xlsx.ts --pending-gmail --guardian-member carla_aguilar_nieto

  # Reasignar guardián después:
  # update umsuka.legal_guardians set is_member=true, member_user_id='<adult_uuid>' where id='<guardian_uuid>';
`);
}

// ── Limpieza / parsing de nombres ───────────────────────────────

function stripSuffixes(raw: string): string {
  let s = raw.trim();
  // Reemplazar � por Ñ (artefacto de latin1 → utf8 en el xlsx original)
  s = s.replace(/�/g, "Ñ").replace(/�/g, "ñ");
  // Normalizar coma como separador: "RODRIGUEZ VALVERDE,BRIAN" → "RODRIGUEZ VALVERDE BRIAN"
  s = s.replace(/,/g, " ");
  // Quitar sufijos tipo "-NUEVO", "-NUEVA", "-NUEVO PTE. INSCR.", "-V.EXC...", " - "
  // Se eliminan a partir del primer " -" o "-"
  // Pero cuidado: no romper "DE LA" etc. Solo si hay guion seguido de palabra clave
  s = s.replace(/\s*-\s*(NUEVO|NUEVA|V\.EXC.*|V\.EXC\.?|V\.EXC EN JUNIO.*|NUEVO PTE.*|NUEVA PTE.*)\s*$/i, "");
  // También quitar trailing "-" suelto
  s = s.replace(/\s*-\s*$/, "");
  // Colapsar espacios múltiples
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// ── CamelCase / TitleCase para nombres ─────────────────────────
// Convierte "ACEVEDO MULERO" → "Acevedo Mulero", "MARIA LEIRE" → "Maria Leire"
// Respeta guiones y apóstrofes, y partículas: "del", "de", "la" quedan en minúscula salvo primera palabra
const LOWER_PARTICLES = new Set(["de", "del", "la", "las", "los", "y", "e", "da", "do", "dos", "das"]);

function toTitleCase(input: string): string {
  return input
    .toLowerCase()
    .split(" ")
    .map((word, idx) => {
      if (!word) return word;
      // Mantener partículas en minúscula si no es la primera palabra
      if (idx !== 0 && LOWER_PARTICLES.has(word)) return word;
      // Manejar guiones: "del-carmen" → "Del-Carmen"
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

// Heurística "APELLIDOS NOMBRE" → { firstName, lastName } en CamelCase
// Lista de tokens que suelen iniciar nombres dobles
const DOUBLE_NAME_START = new Set([
  "MARIA",
  "MARÍA",
  "JOSE",
  "JOSÉ",
  "JUAN",
  "ANA",
  "LUIS",
  "CARLOS",
  "FRANCISCO",
  "FRANCISCA",
  "ANTONIO",
  "M",
]);

function parseSpanishFullName(cleaned: string): { firstName: string; lastName: string } {
  const tokens = cleaned.split(" ").filter(Boolean);
  if (tokens.length === 0) return { firstName: "", lastName: "" };
  if (tokens.length === 1) return { firstName: toTitleCase(tokens[0]), lastName: "-" };
  if (tokens.length === 2) return { firstName: toTitleCase(tokens[1]), lastName: toTitleCase(tokens[0]) };

  // 3+ tokens
  const last = tokens[tokens.length - 1];
  const penult = tokens[tokens.length - 2];

  // Si penúltimo es inicio típico de nombre doble → tomar 2 últimas como firstName
  if (DOUBLE_NAME_START.has(penult.toUpperCase())) {
    const firstName = toTitleCase(tokens.slice(-2).join(" "));
    const lastName = toTitleCase(tokens.slice(0, -2).join(" "));
    return { firstName, lastName: lastName || "-" };
  }

  // Si hay partícula "DEL", "DE", "LA" justo antes → suele ser apellido compuesto, no nombre
  // Ej: BARRIENTOS DEL CARMEN SONIA → tokens ["BARRIENTOS","DEL","CARMEN","SONIA"]
  //   penult=CARMEN no está en DOUBLE_NAME_START, pero queremos firstName=SONIA, lastName=BARRIENTOS DEL CARMEN
  //   Con regla simple last=SONIA es correcto. No tomar 2.
  // Para 4 tokens con doble nombre real: "LOZANO PINILLA JOSE RAMON" → penult=JOSE → entra arriba → firstName=JOSE RAMON
  return { firstName: toTitleCase(last), lastName: toTitleCase(tokens.slice(0, -1).join(" ")) };
}

function slugifyUsername(firstName: string, lastName: string, fallback: string): string {
  const raw = `${firstName} ${lastName}`.trim() || fallback;
  let s = raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar acentos
    .toLowerCase()
    .replace(/ñ/g, "n")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/__+/g, "_");
  if (s.length < 3) s = (s + "_user").slice(0, 30);
  if (s.length > 30) s = s.slice(0, 30).replace(/_+$/g, "");
  // Debe empezar con letra/número y solo [a-z0-9_]
  if (!/^[a-z0-9_]+$/.test(s)) s = s.replace(/[^a-z0-9_]/g, "_");
  if (s.length < 3) s = `user_${s}`.slice(0, 30);
  return s;
}

function generateSecurePassword(): string {
  // Debe cumplir passwordStrengthSchema: 8+, may, min, dígito, especial
  const lowers = "abcdefghijklmnopqrstuvwxyz";
  const uppers = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const specials = "!@#$%*_-+?";
  const all = lowers + uppers + digits + specials;

  function pick(str: string) {
    return str[Math.floor(Math.random() * str.length)];
  }

  // Garantizar al menos uno de cada clase
  let pwd = pick(uppers) + pick(lowers) + pick(digits) + pick(specials);
  const len = 12 + Math.floor(Math.random() * 4); // 12-15
  for (let i = pwd.length; i < len; i++) pwd += pick(all);
  // Shuffle
  pwd = pwd
    .split("")
    .sort(() => Math.random() - 0.5)
    .join("");
  // Añadir sufijo determinístico para cumplir longitud mínima si hace falta
  return pwd;
}

function validatePasswordOrExit(pwd: string) {
  const checks: [RegExp, string][] = [
    [/.{8,}/, "mínimo 8 caracteres"],
    [/[A-Z]/, "una mayúscula"],
    [/[a-z]/, "una minúscula"],
    [/[0-9]/, "un número"],
    [/[^a-zA-Z0-9]/, "un carácter especial"],
  ];
  const fails = checks.filter(([re]) => !re.test(pwd)).map(([, msg]) => msg);
  if (fails.length) {
    console.error(`[error] --default-password no cumple el schema: falta ${fails.join(", ")}.`);
    console.error(`Valor recibido: "${pwd}"`);
    process.exit(1);
  }
}

// ── Main ─────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  if (args.defaultPassword) validatePasswordOrExit(args.defaultPassword);

  if (!fs.existsSync(args.file)) {
    console.error(`[error] No se encontró el XLSX: ${args.file}`);
    console.error(`Pasa --file <ruta> o coloca el archivo en scripts/data/listado-sorteo-2027.xlsx`);
    process.exit(1);
  }

  console.log(`\n[import-members] Leyendo XLSX: ${args.file}`);

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(args.file);

  const worksheet = args.sheet ? workbook.getWorksheet(args.sheet) : workbook.worksheets[0];
  if (!worksheet) {
    console.error(`[error] No se encontró la hoja "${args.sheet}"`);
    console.error(`Hojas disponibles: ${workbook.worksheets.map((w) => w.name).join(", ")}`);
    process.exit(1);
  }
  console.log(`[import-members] Hoja: "${worksheet.name}" (${worksheet.rowCount} filas, ${worksheet.columnCount} cols)`);

  // Recolectar miembros
  type Member = {
    row: number;
    raw: string;
    cleaned: string;
    firstName: string;
    lastName: string;
    category: "adulto" | "nino";
    usernameBase: string;
    username: string;
    password: string;
    componentType: string;
    workgroup: string;
    isMinor: boolean;
  };

  const members: Member[] = [];
  let currentCategory: "adulto" | "nino" = "adulto";
  let seenAdultHeader = false;

  function cellToString(cell: ExcelJS.Cell): string {
    const v: unknown = cell.value;
    if (v == null) return "";
    if (typeof v === "string") return v.trim();
    if (typeof v === "number") return String(v).trim();
    if (typeof v === "object") {
      const obj = v as Record<string, unknown>;
      // RichText
      if (Array.isArray(obj.richText)) {
        return (obj.richText as Array<{ text: string }>)
          .map((r) => r.text)
          .join("")
          .trim();
      }
      if (typeof obj.text === "string") return (obj.text as string).trim();
      if (typeof obj.result === "string" || typeof obj.result === "number")
        return String(obj.result).trim();
      // Hyperlink
      if (typeof obj.hyperlink === "string" && typeof obj.text === "string")
        return (obj.text as string).trim();
      return String(v).trim();
    }
    return String(v).trim();
  }

  worksheet.eachRow((row, rowNumber) => {
    const colA = cellToString(row.getCell(1));
    const colB = cellToString(row.getCell(2));
    const colAText = colA.trim();

    // Detectar cabeceras de sección
    const upperA = colAText.toUpperCase();
    if (upperA.includes("ADULTOS")) {
      currentCategory = "adulto";
      seenAdultHeader = true;
      return;
    }
    if (upperA.includes("NIÑOS") || upperA.includes("NINOS") || upperA.includes("NI\xd1OS") || upperA.includes("F/CARNVAL") || upperA.includes("F/CARN")) {
      currentCategory = "nino";
      return;
    }
    if (upperA === "TOTALES" || upperA === "TOTAL") return;
    if (upperA.includes("IMPORTES") || upperA === "NC" || upperA.includes("OBSERVACIONES")) return;
    if (!colAText) return; // fila vacía / separador
    if (colAText === " " || colAText.length < 3) return;

    // Filtro: sólo filas que parecen nombres (col A con letras y col B vacía o 1)
    // Algunos xlsx tienen colB = 1 (NC)
    const isNameRow = /[A-ZÁÉÍÓÚÑ]/i.test(colAText) && colAText.split(" ").length >= 2;
    if (!isNameRow) return;

    // Evitar filas de totales que ya filtramos
    if (/TOTAL/i.test(colAText)) return;

    const cleaned = stripSuffixes(colAText);
    if (!cleaned || cleaned.length < 3) return;
    if (cleaned.toUpperCase() === "TOTALES" || cleaned.toUpperCase().includes("ADULTOS") || cleaned.toUpperCase().includes("NIÑOS")) return;

    const { firstName, lastName } = parseSpanishFullName(cleaned);
    if (!firstName || !lastName) return;

    const usernameBase = slugifyUsername(firstName, lastName, cleaned);
    const password = args.defaultPassword ?? generateSecurePassword();

    members.push({
      row: rowNumber,
      raw: colAText,
      cleaned,
      firstName,
      lastName,
      category: currentCategory,
      usernameBase,
      username: usernameBase, // se deduplica luego
      password,
      componentType: args.componentType,
      workgroup: args.workgroup,
      isMinor: currentCategory === "nino",
    });
  });

  if (members.length === 0) {
    console.error("[error] No se detectaron miembros en el XLSX. Revisa el formato de la hoja.");
    process.exit(1);
  }

  if (args.limit && args.limit > 0) {
    members.splice(args.limit);
    console.log(`[import-members] --limit ${args.limit} → se procesarán solo ${members.length} miembros`);
  }

  // Deduplicar usernames dentro del propio archivo
  const usernameCounts = new Map<string, number>();
  for (const m of members) {
    let base = m.usernameBase.slice(0, 28); // reservar espacio para sufijo _N
    let candidate = base;
    let n = 1;
    while (usernameCounts.has(candidate)) {
      candidate = `${base.slice(0, 27)}_${n}`.slice(0, 30);
      n++;
      if (n > 99) {
        candidate = `${base.slice(0, 22)}_${randomUUID().slice(0, 6)}`.slice(0, 30);
        break;
      }
    }
    // También manejar colisión futura por truncamiento
    usernameCounts.set(candidate, 1);
    m.username = candidate;
  }

  const adultos = members.filter((m) => m.category === "adulto").length;
  const ninos = members.filter((m) => m.category === "nino").length;
  const modoAuth = args.pendingGmail ? "pending_gmail (pre-registro, invite_token)" : "email_alias (cuenta local)";
  console.log(`[import-members] Detectados: ${members.length} miembros (${adultos} adultos, ${ninos} niños)`);
  console.log(`[import-members] Modo: ${modoAuth} | component_type=${args.componentType} workgroup=${args.workgroup} ${args.pendingGmail ? "" : `status=${args.active ? "active" : "pending"}`}`);
  if (args.pendingGmail) {
    console.log(`[import-members] Pre-registro: link_status=pending_gmail, invite_token generado, sin username/password — superadmin vincula luego en /admin/members`);
  } else {
    if (args.defaultPassword) console.log(`[import-members] Usando --default-password para todos`);
    else console.log(`[import-members] Generando contraseña aleatoria por usuario`);
  }
  if (!args.noGuardian && ninos > 0) {
    const modeLabel = args.guardianMode === "per-child" ? `${ninos} guardianes (1 por niño)` : `1 guardián compartido para ${ninos} niños`;
    const memberLabel = args.guardianMember ? ` → vinculado a @${args.guardianMember} (is_member=true)` : " → vacío (is_member=false, por asignar)";
    console.log(`[import-members] Guardianes infantiles: ${modeLabel}${memberLabel} — nombre: "${args.guardianName}"`);
  } else if (ninos > 0) {
    console.log(`[import-members] Guardianes infantiles: --no-guardian (niños quedarán sin legal_guardian_id)`);
  }

  // Preview en consola
  console.log("\n--- Preview (primeros 10) ---");
  for (const m of members.slice(0, 10)) {
    const cred = args.pendingGmail ? `invite pending` : `pwd: ${m.password}`;
    console.log(
      `  ${m.username.padEnd(30)} | ${m.firstName} ${m.lastName} | raw: "${m.raw}" | ${cred} | ${m.category}${m.isMinor ? " (menor)" : ""}`,
    );
  }
  if (members.length > 10) console.log(`  ... y ${members.length - 10} más`);
  if (!args.noGuardian && ninos > 0) {
    console.log("\n--- Preview guardianes ---");
    if (args.guardianMode === "shared") {
      console.log(`  1 x "${args.guardianName}" (is_member=${!!args.guardianMember}, member_user_id=${args.guardianMember ?? "null"}) → ${ninos} niños`);
    } else {
      for (const m of members.filter((x) => x.isMinor).slice(0, 5)) {
        console.log(`  "Tutor de ${m.firstName} ${m.lastName} — por asignar" → ${m.username}`);
      }
      if (ninos > 5) console.log(`  ... y ${ninos - 5} más`);
    }
  }

  // ── DRY-RUN: solo CSV ────────────────────────────────────────
  if (args.dryRun) {
    const ts = new Date().toISOString().slice(0, 10);
    const outPath = args.output ?? path.resolve(`scripts/data/preview-${ts}.csv`);
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    if (args.pendingGmail) {
      const header =
        "username,invite_token,first_name,last_name,raw_name,cleaned_name,category,is_minor,component_type,workgroup,row,guardian_mode,guardian_target,link_status,auth_method\n";
      const rows = members
        .map((m) => {
          const guardianTarget =
            !m.isMinor || args.noGuardian
              ? ""
              : args.guardianMode === "shared"
                ? args.guardianName
                : `Tutor de ${m.firstName} ${m.lastName} — por asignar`;
          const fakeInvite = `preview-${m.username}`;
          return `${m.username},${fakeInvite},"${m.firstName.replace(/"/g, '""')}","${m.lastName.replace(/"/g, '""')}","${m.raw.replace(/"/g, '""')}","${m.cleaned.replace(/"/g, '""')}",${m.category},${m.isMinor},${m.componentType},${m.workgroup},${m.row},${args.noGuardian ? "none" : args.guardianMode},"${guardianTarget.replace(/"/g, '""')}",pending_gmail,google`;
        })
        .join("\n");
      fs.writeFileSync(outPath, header + rows, "utf8");
      console.log(`\n[dry-run] Preview CSV (modo pending_gmail) generado: ${outPath}`);
      console.log(`[dry-run] Revisa el CSV — en real se generará invite_token UUID por perfil.`);
    } else {
      const header =
        "username,password,first_name,last_name,raw_name,cleaned_name,category,is_minor,component_type,workgroup,row,guardian_mode,guardian_target,link_status,auth_method\n";
      const rows = members
        .map((m) => {
          const guardianTarget =
            !m.isMinor || args.noGuardian
              ? ""
              : args.guardianMode === "shared"
                ? args.guardianName
                : `Tutor de ${m.firstName} ${m.lastName} — por asignar`;
          return `${m.username},${m.password},"${m.firstName.replace(/"/g, '""')}","${m.lastName.replace(/"/g, '""')}","${m.raw.replace(/"/g, '""')}","${m.cleaned.replace(/"/g, '""')}",${m.category},${m.isMinor},${m.componentType},${m.workgroup},${m.row},${args.noGuardian ? "none" : args.guardianMode},"${guardianTarget.replace(/"/g, '""')}",linked,email_alias`;
        })
        .join("\n");
      fs.writeFileSync(outPath, header + rows, "utf8");
      console.log(`\n[dry-run] Preview CSV generado: ${outPath}`);
      console.log(`[dry-run] Revisa el CSV, corrige nombres si hace falta, luego ejecuta sin --dry-run para crear en Supabase.`);
    }
    console.log(`[dry-run] No se ha tocado la base de datos.`);
    if (!args.noGuardian && ninos > 0 && args.guardianMember) {
      console.log(`[dry-run] Nota: --guardian-member @${args.guardianMember} se resolverá a UUID en la importación real (debe existir entre los adultos creados o ya en BD).`);
    }
    return;
  }

  // ── IMPORTACIÓN REAL ─────────────────────────────────────────
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    console.error("\n[error] Faltan variables de entorno para Supabase:");
    console.error("  NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY son obligatorias.");
    console.error("  Carga .env.local o exporta las variables antes de ejecutar.");
    console.error("  Tip: copia .env.example → .env.local y rellena los valores.");
    process.exit(1);
  }

  // Validar workgroup/component_type coherencia (misma regla que la BD)
  if ((args.componentType === "music" || args.componentType === "dance") && args.workgroup === "ninguno") {
    console.error(`[error] component_type=${args.componentType} requiere workgroup != ninguno (regla BD).`);
    console.error(`Pasa --workgroup telas|barra|estandarte|limpieza o usa --component-type member.`);
    process.exit(1);
  }

  const { createClient } = await import("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceKey, {
    db: { schema: "umsuka" },
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Necesitamos el actor (super_admin) para p_created_by / pre_registered_by.
  let createdBy: string | null = null;
  {
    const { data, error } = await admin.from("profiles").select("id, role").eq("role", "super_admin").limit(1);
    if (!error && data && data.length > 0) createdBy = data[0].id;
    else {
      const { data: data2 } = await admin.from("profiles").select("id, role").in("role", ["super_admin", "admin"]).limit(1);
      if (data2 && data2.length > 0) createdBy = data2[0].id;
    }
  }
  if (!createdBy) {
    console.error("\n[error] No se encontró ningún perfil super_admin/admin para usar como p_created_by / pre_registered_by.");
    console.error("Crea primero un super_admin manualmente.");
    process.exit(1);
  }
  console.log(`[import-members] Usando created_by (super_admin): ${createdBy}`);

  const EMAIL_ALIAS_DOMAIN = "umsuka.internal";
  type Result = Member & { status: "ok" | "skipped" | "error"; error?: string; aliasEmail?: string; profileId?: string; guardianId?: string; inviteToken?: string };
  const results: Array<Result> = [];

  let ok = 0;
  let skipped = 0;
  let failed = 0;

  // Para resolver --guardian-member después de crear perfiles
  const createdProfileByUsername = new Map<string, string>(); // username -> profileId
  const createdProfileByName = new Map<string, string>(); // "first|last" lower -> id (para modo pending)

  if (args.pendingGmail) {
    // ── MODO PENDING_GMAIL (pre-registro) ───────────────────────
    // Nota: profiles.id tiene FK a auth.users(id) ON DELETE CASCADE, por lo que
    // no podemos insertar un id random sin fila en auth.users (violación
    // profiles_id_fkey). Creamos un auth user "placeholder" por cada perfil
    // con email pending-{uuid}@umsuka.pending (nunca usado para login).
    // La vinculación luego es LÓGICA vía pending_email, la PK no cambia.
    console.log(`\n[import-members] Modo pending_gmail: creando ${members.length} perfiles (placeholder auth + invite_token)...`);
    // Comprobar duplicados por nombre (first_name + last_name case-insensitive)
    console.log(`[import-members] Comprobando duplicados por nombre en BD...`);
    const { data: allExisting } = await admin.from("profiles").select("id, first_name, last_name");
    const existingByName = new Set<string>();
    const existingNameToId = new Map<string, string>();
    for (const row of (allExisting as Array<{ id: string; first_name: string; last_name: string }> | null) ?? []) {
      const key = `${row.first_name.trim().toLowerCase()}|${row.last_name.trim().toLowerCase()}`;
      existingByName.add(key);
      existingNameToId.set(key, row.id);
    }
    const normKey = (fn: string, ln: string) => `${fn.trim().toLowerCase()}|${ln.trim().toLowerCase()}`;

    for (const m of members) {
      const key = normKey(m.firstName, m.lastName);
      if (existingByName.has(key)) {
        const existingId = existingNameToId.get(key);
        if (existingId) createdProfileByName.set(key, existingId);
        createdProfileByUsername.set(m.username, existingId!);
        results.push({ ...m, status: "skipped", error: "nombre ya existe en BD", profileId: existingId });
        skipped++;
        console.log(`[skip] ${m.firstName} ${m.lastName} (${m.username}) — ya existe`);
        continue;
      }

      const invite_token = randomUUID();
      const placeholderEmail = `pending-${randomUUID()}@umsuka.pending`;
      const placeholderPassword = randomUUID() + "Aa1!";

      // 1) Crear auth user placeholder para satisfacer FK profiles_id_fkey
      const { data: authData, error: authError } = await admin.auth.admin.createUser({
        email: placeholderEmail,
        password: placeholderPassword,
        email_confirm: true,
        user_metadata: { pending_gmail: true, invite_token, first_name: m.firstName, last_name: m.lastName },
      });

      if (authError || !authData?.user) {
        const msg = authError?.message ?? "createUser sin data";
        results.push({ ...m, status: "error", error: `auth.createUser (pending): ${msg}` });
        failed++;
        console.error(`[error] ${m.firstName} ${m.lastName} — auth placeholder: ${msg}`);
        continue;
      }

      const newId = authData.user.id;

      // 2) El trigger handle_new_user() ya creó un profile vacío para este auth user.
      //    Lo actualizamos a pending_gmail con los datos del Excel.
      const { error: updateError, data: updated } = await admin
        .from("profiles")
        .update({
          first_name: m.firstName,
          last_name: m.lastName,
          component_type: m.componentType,
          workgroup: m.workgroup,
          role: "member",
          is_minor: m.isMinor,
          link_status: "pending_gmail",
          pre_registered_by: createdBy,
          invite_token,
          pending_email: null,
          is_active: true,
          status: "active",
          auth_method: "google",
        } as never)
        .eq("id", newId)
        .select("id, invite_token")
        .single();

      if (updateError) {
        // Rollback auth user si el profile falla (ej. workgroup check)
        await admin.auth.admin.deleteUser(newId).catch(() => {});
        results.push({ ...m, status: "error", error: `profiles.update: ${updateError.message}` });
        failed++;
        console.error(`[error] ${m.firstName} ${m.lastName} — update: ${updateError.message}`);
        continue;
      }

      const pid = (updated as { id: string }).id ?? newId;
      const token = (updated as { invite_token: string | null })?.invite_token ?? invite_token;
      createdProfileByUsername.set(m.username, pid);
      createdProfileByName.set(key, pid);
      results.push({ ...m, status: "ok", profileId: pid, inviteToken: token, aliasEmail: placeholderEmail });
      ok++;
      console.log(`[ok] ${m.firstName} ${m.lastName} (${m.username}) → pending_gmail id=${pid} invite=/invite/${token} (placeholder ${placeholderEmail})`);
    }
  } else {
    // ── MODO EMAIL_ALIAS (cuenta local, default) ───────────────
    console.log(`\n[import-members] Modo email_alias: creando ${members.length} cuentas locales...`);
    // Comprobar duplicados ya existentes en BD (usernames)
    console.log(`[import-members] Comprobando duplicados por username en BD...`);
    const usernames = members.map((m) => m.username);
    const existing = new Set<string>();
    for (let i = 0; i < usernames.length; i += 100) {
      const chunk = usernames.slice(i, i + 100);
      const { data, error } = await admin.from("profiles").select("username").in("username", chunk);
      if (error) {
        console.warn(`[warn] No se pudo comprobar duplicados (chunk ${i}): ${error.message}`);
        continue;
      }
      for (const row of data ?? []) if (row.username) existing.add(row.username);
    }
    if (existing.size > 0) {
      console.warn(`[warn] ${existing.size} usernames ya existen en BD y se saltarán:`);
      for (const u of existing) console.warn(`  - ${u}`);
    }

    for (const m of members) {
      if (existing.has(m.username)) {
        const { data: existingProfile } = await admin.from("profiles").select("id").eq("username", m.username).maybeSingle();
        if (existingProfile?.id) createdProfileByUsername.set(m.username, existingProfile.id);
        results.push({ ...m, status: "skipped", error: "username ya existe en BD", profileId: existingProfile?.id });
        skipped++;
        console.log(`[skip] ${m.username} — ya existe`);
        continue;
      }

      const aliasEmail = `user-${randomUUID()}@${EMAIL_ALIAS_DOMAIN}`;

      // 1. Crear auth user
      const { data: authData, error: authError } = await admin.auth.admin.createUser({
        email: aliasEmail,
        password: m.password,
        email_confirm: true,
        user_metadata: {
          username: m.username,
          auth_method: "email_alias",
        },
      });

      if (authError || !authData?.user) {
        const msg = authError?.message ?? "createUser sin data";
        results.push({ ...m, status: "error", error: `auth.createUser: ${msg}`, aliasEmail });
        failed++;
        console.error(`[error] ${m.username} — auth.createUser: ${msg}`);
        continue;
      }

      const newUserId = authData.user.id;

      // 2. Crear profile + alias via RPC
      const { error: rpcError } = await admin.rpc("create_emailless_profile", {
        p_id: newUserId,
        p_first_name: m.firstName,
        p_last_name: m.lastName,
        p_username: m.username,
        p_component_type: m.componentType,
        p_alias_email: aliasEmail,
        p_created_by: createdBy,
        p_workgroup: m.workgroup,
        p_status: args.active ? "active" : "pending",
      });

      if (rpcError) {
        await admin.auth.admin.deleteUser(newUserId).catch(() => {});
        results.push({ ...m, status: "error", error: `rpc create_emailless_profile: ${rpcError.message}`, aliasEmail });
        failed++;
        console.error(`[error] ${m.username} — rpc: ${rpcError.message}`);
        continue;
      }

      if (m.isMinor) {
        const { error: minorError } = await admin.from("profiles").update({ is_minor: true }).eq("id", newUserId);
        if (minorError) {
          console.warn(`[warn] ${m.username} — no se pudo marcar is_minor=true: ${minorError.message}`);
        }
      }

      createdProfileByUsername.set(m.username, newUserId);
      createdProfileByName.set(`${m.firstName.trim().toLowerCase()}|${m.lastName.trim().toLowerCase()}`, newUserId);
      results.push({ ...m, status: "ok", aliasEmail, profileId: newUserId });
      ok++;
      console.log(`[ok] ${m.username} (${m.firstName} ${m.lastName}) → ${aliasEmail}`);
    }
  }

  // ── Guardianes para infantiles ─────────────────────────────────
  let guardiansCreated = 0;
  const minorResults = results.filter((r) => r.isMinor && r.status !== "error");
  const shouldCreateGuardians = !args.noGuardian && minorResults.length > 0;

  // Resolver member_user_id para --guardian-member si se pidió
  let guardianMemberId: string | null = null;
  if (shouldCreateGuardians && args.guardianMember) {
    const targetUsername = args.guardianMember;
    // 1) buscar entre los recién creados
    guardianMemberId = createdProfileByUsername.get(targetUsername) ?? null;
    // 2) si no está, buscar en BD
    if (!guardianMemberId) {
      const { data, error } = await admin.from("profiles").select("id, is_minor, is_active, status").eq("username", targetUsername).maybeSingle();
      if (error || !data) {
        console.error(`[error] --guardian-member @${targetUsername} no encontrado en BD ni en la importación. Se usará guardián vacío (is_member=false).`);
      } else if (data.is_minor) {
        console.error(`[error] --guardian-member @${targetUsername} es menor (is_minor=true) — no puede ser representante. Se usará guardián vacío.`);
        guardianMemberId = null;
      } else if (!data.is_active || data.status !== "active") {
        console.warn(`[warn] --guardian-member @${targetUsername} no está activo (status=${data.status}) pero se usará igualmente.`);
        guardianMemberId = data.id;
      } else {
        guardianMemberId = data.id;
        console.log(`[guardian] Vinculando guardián(es) a @${targetUsername} (${guardianMemberId})`);
      }
    } else {
      // Verificar que no sea menor
      const r = results.find((x) => x.username === targetUsername);
      if (r?.isMinor) {
        console.error(`[error] --guardian-member @${targetUsername} es menor — no puede ser representante. Se usará guardián vacío.`);
        guardianMemberId = null;
      } else {
        console.log(`[guardian] Vinculando guardián(es) a @${targetUsername} (${guardianMemberId}) — recién creado en esta importación`);
      }
    }
  }

  if (shouldCreateGuardians) {
    console.log(`\n[guardian] Creando representante(s) para ${minorResults.length} niños (modo=${args.guardianMode})...`);
    try {
      if (args.guardianMode === "shared") {
        // Un único guardián para todos
        const { data: guardian, error: gError } = await admin
          .from("legal_guardians")
          .insert({
            full_name: args.guardianName,
            is_member: !!guardianMemberId,
            member_user_id: guardianMemberId,
            created_by: createdBy,
          })
          .select("id")
          .single();

        if (gError || !guardian) {
          console.error(`[error] No se pudo crear el guardián compartido: ${gError?.message}`);
          if (gError?.message?.includes("permission denied")) {
            console.error(`[fix] Ejecuta en Supabase Dashboard → SQL Editor (como super_admin):`);
            console.error(`  grant all on table umsuka.legal_guardians to service_role;`);
            console.error(`  grant all on table umsuka.legal_guardians to authenticated;`);
            console.error(`[fix] O re-ejecuta el import con --no-guardian y crea el guardián luego desde la UI (/admin/members → Representante legal).`);
            console.error(`[fix] Migración local ya creada: supabase/migrations/20260101007400_legal_guardians_service_role_grants.sql — haz supabase db push cuando tengas SUPABASE_ACCESS_TOKEN.`);
          }
        } else {
          guardiansCreated = 1;
          console.log(`[guardian] Creado guardián compartido "${args.guardianName}" id=${guardian.id} is_member=${!!guardianMemberId}`);

          // Asignar a cada menor
          for (const mr of minorResults) {
            if (!mr.profileId) continue;
            const { error: updErr } = await admin.from("profiles").update({ legal_guardian_id: guardian.id }).eq("id", mr.profileId);
            if (updErr) console.warn(`[warn] No se pudo asignar guardián a ${mr.username}: ${updErr.message}`);
            else {
              mr.guardianId = guardian.id;
              console.log(`[guardian] Asignado ${guardian.id} → ${mr.username}`);
            }
          }
        }
      } else {
        // per-child: un guardián por menor
        for (const mr of minorResults) {
          if (!mr.profileId) continue;
          const gName = `Tutor de ${mr.firstName} ${mr.lastName} — por asignar`;
          const { data: guardian, error: gError } = await admin
            .from("legal_guardians")
            .insert({
              full_name: gName,
              is_member: !!guardianMemberId,
              member_user_id: guardianMemberId,
              created_by: createdBy,
            })
            .select("id")
            .single();

          if (gError || !guardian) {
            console.warn(`[warn] No se pudo crear guardián para ${mr.username}: ${gError?.message}`);
            if (gError?.message?.includes("permission denied")) {
              console.warn(`[fix] permission denied en legal_guardians — ejecuta GRANT en Dashboard SQL Editor y reintenta, o usa --no-guardian`);
            }
            continue;
          }
          guardiansCreated++;
          mr.guardianId = guardian.id;
          const { error: updErr } = await admin.from("profiles").update({ legal_guardian_id: guardian.id }).eq("id", mr.profileId);
          if (updErr) console.warn(`[warn] No se pudo asignar guardián ${guardian.id} a ${mr.username}: ${updErr.message}`);
          else console.log(`[guardian] Creado ${guardian.id} ("${gName}") → ${mr.username}`);
        }
      }
    } catch (e) {
      console.error(`[error] Fallo creando guardianes: ${(e as Error).message}`);
    }
    console.log(`[guardian] Total guardianes creados: ${guardiansCreated}`);
    if (guardiansCreated > 0) {
      console.log(`[guardian] Para reasignar después:`);
      console.log(`  -- Si es vacío (is_member=false):`);
      console.log(`     update umsuka.legal_guardians set is_member=true, member_user_id='<adult_uuid>' where id='<guardian_uuid>';`);
      console.log(`  -- O desde la UI: Gestión de menores → editar representante → vincular a miembro existente`);
    }
  } else if (!args.noGuardian && minorResults.length === 0) {
    console.log(`[guardian] No hay niños para asignar guardián.`);
  }

  // Escribir CSV de resultado
  const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const outPath = args.output ?? path.resolve(`scripts/data/${args.pendingGmail ? "pre-registro" : "credenciales"}-${ts}.csv`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });

  let header: string;
  let csvRows: string;
  const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
  if (args.pendingGmail) {
    header = "first_name,last_name,raw_name,category,profile_id,invite_token,invite_url,link_status,auth_method,status,error,guardian_id,is_minor\n";
    csvRows = results
      .map((r) => {
        const inviteUrl = r.inviteToken ? `/invite/${r.inviteToken}` : "";
        return `${esc(r.firstName)},${esc(r.lastName)},${esc(r.raw)},${r.category},${r.profileId ?? ""},${r.inviteToken ?? ""},${inviteUrl},pending_gmail,google,${r.status},${esc(r.error ?? "")},${r.guardianId ?? ""},${r.isMinor}`;
      })
      .join("\n");
  } else {
    header = "username,password,first_name,last_name,raw_name,category,alias_email,status,error,profile_id,guardian_id,is_minor,legal_guardian_id,link_status,auth_method\n";
    csvRows = results
      .map((r) => {
        return `${r.username},${r.password},${esc(r.firstName)},${esc(r.lastName)},${esc(r.raw)},${r.category},${r.aliasEmail ?? ""},${r.status},${esc(r.error ?? "")},${r.profileId ?? ""},${r.guardianId ?? ""},${r.isMinor},${r.guardianId ?? ""},linked,email_alias`;
      })
      .join("\n");
  }
  fs.writeFileSync(outPath, header + csvRows, "utf8");

  console.log(`\n─────────────────────────────────────────────`);
  console.log(`[resumen] Modo: ${args.pendingGmail ? "pending_gmail (pre-registro)" : "email_alias (cuenta local)"} | Total: ${members.length} | OK: ${ok} | Saltados: ${skipped} | Errores: ${failed}`);
  if (shouldCreateGuardians) console.log(`[resumen] Guardianes: ${guardiansCreated} creado(s) para ${minorResults.length} niños (modo=${args.guardianMode})`);
  console.log(`[resumen] CSV: ${outPath}`);
  if (ok > 0) {
    if (args.pendingGmail) {
      console.log(`\n[IMPORTANTE] CSV con invite_token. Superadmin vincula en /admin/members con "Vincular Gmail" o compartiendo /invite/<token>.`);
      console.log(`  El histórico (pagos, asistencia) queda vinculado a la misma PK y no se duplica al vincular.`);
    } else {
      console.log(`\n[IMPORTANTE] El CSV contiene contraseñas en claro.`);
      console.log(`  - Entrégalo por canal seguro y bórralo tras su uso.`);
      console.log(`  - No hacer commit/push del CSV (añadido a .gitignore).`);
      console.log(`  - Superadmin puede resetear password después con el flujo de password_reset_tokens.`);
    }
  }
  if (failed > 0) {
    console.log(`\n[errores] Detalle:`);
    for (const r of results.filter((x) => x.status === "error")) {
      console.log(`  - ${r.username}: ${r.error}`);
    }
    process.exitCode = 1;
  }
}

main().catch((e) => {
  console.error(`[fatal] ${e?.message ?? e}`);
  console.error(e?.stack);
  process.exit(1);
});
