# ADR-029: Sprint 29 — Gestión de Dinero de la Comparsa (Money Management)

**Status:** Accepted (Implementado) · **Date:** 2026-08-25 · **Sprint:** 29 ·
**Branch:** `feature/sprint-29-money-management`

---

## Context

La comparsa necesitaba llevar el control del dinero desde la aplicación: registrar **ingresos** (turnos de barra) y **gastos** (compras de barra, material del traje, material para baile, otros), con resumen de totales, saldo y desglose por categoría, más estadísticas mensuales. **Solo la directiva** (`super_admin`, `admin`, `board_member`, `event_manager`) puede ver y gestionar esa información; el resto de miembros no debe ni siquiera poder consultar los datos (no basta con ocultar el menú).

Requisitos (criterios de aceptación del task file):

- La directiva y el super_admin pueden registrar ingresos y gastos con categorías predefinidas (turno de barra, compras de barra, material del traje, material para baile, otros).
- La página `/finances` y todos sus datos son **invisibles** para el resto de roles (RLS + guards, no solo ocultar el menú).
- La vista de resumen muestra totales de ingresos, gastos, **saldo** y desglose por categoría.
- Se pueden consultar estadísticas mensuales de ingresos vs gastos (gráfico CSS/SVG puro, sin librería).
- Las transacciones se pueden filtrar por tipo, categoría y rango de fechas.
- Las transacciones se pueden crear, editar y eliminar (solo directiva).
- La navegación "Finanzas" solo aparece para directiva.

Dependencias declaradas: **Sprint 2 (Roles)**, **Sprint 21 (Admin Panel)** y **Sprint 3 (Barra)**.

La implementación vive en la rama `feature/sprint-29-money-management` y se apoya en los patrones consolidados del repo (instruments, rehearsals, votings).

### Estado previo

- No existía tabla financiera; `src/lib` no tenía módulo `finances`.
- Patrones reutilizados:
  - RLS `ENABLE + FORCE` + políticas `is_management()` (instruments, migrations 0056/0058).
  - Helper `umsuka.is_management()` (0013, `SECURITY DEFINER`, `stable`, grant a `authenticated`) que ya cubre exactamente `MANAGEMENT_ROLES` — documentado en ADR-24 D4 como fuente de verdad para "directiva".
  - Zod isomórfico con mensajes en español y normalización `"" → null` (instruments/schema.ts).
  - `MutationResult { success, error?, id? }` + `requireManagementGuard` (votings/mutations.ts).
  - Server actions thin con `revalidatePath` (instruments/actions.ts).
  - Gráficas con barras CSS puras en server/client sin librería (`results-chart.tsx`, `trend-chart.tsx`).
  - `database.types.ts` editado a mano (sin Supabase CLI en el entorno) + checklist manual pre-deploy.
- Última migración: `20260101006100_fix_user_preferences_entry.sql`; este sprint usa **0062**.

---

## Decisión

### D1 — Tabla `umsuka.transactions` con ENUMs nativos, `amount > 0` y `date`

`supabase/migrations/20260101006200_finances.sql`:

| Elemento | Definición |
|---|---|
| ENUMs | `umsuka.transaction_type` (`income`, `expense`) y `umsuka.transaction_category` (`bar_shift`, `bar_purchases`, `costume_materials`, `dance_materials`, `other`) — tipado fuerte, alineado con `rehearsal_session` (0058). Dominio cerrado y estable; una nueva categoría se añadiría con `ALTER TYPE ... ADD VALUE` en migración separada (restricción PG: no puede ir dentro de la misma transacción que usa el nuevo valor). |
| Tabla | `umsuka.transactions (id uuid PK default gen_random_uuid(), type transaction_type not null, category transaction_category not null, amount numeric(10,2) not null check (amount > 0), description text check (char_length <=2000), transaction_date date not null default current_date, created_by uuid references profiles(id) on delete set null, created_at/updated_at timestamptz default now())` |
| Índices | `transaction_date desc`, `type`, `category`, `created_by`, `type+transaction_date desc`, `created_at desc` (este último para listados; los compuestos aceleran filtros combinados y la gráfica mensual). |
| Trigger | `trg_transactions_updated_at` → `umsuka.update_updated_at_column()` (0018) en `BEFORE UPDATE`. |
| Comentarios | `comment on table/column` documentando semántica de tipo/categoría/amount. |

Elecciones conscientes:

- **`amount` siempre positivo**; el signo lo da `type` y el saldo es `SUM(income) - SUM(expense)`. CHECK `amount > 0` rechaza 0 y negativos.
- **`transaction_date` es `date`**, no `timestamptz`: la hora es irrelevante para contabilidad de comparsa y simplifica filtros mensuales y gráfica sin off-by-one por TZ (decisión documentada en plan).
- **`created_by ON DELETE SET NULL`**: conserva la fila si el perfil se borra (hard delete excepcional; `profiles` es soft-delete).
- **No hay moneda**: euro implícito; `numeric(10,2)` permite 99.999.999,99 € (suficiente para la comparsa).

### D2 — RLS directiva exclusiva, sin helper duplicado

```sql
alter table umsuka.transactions enable row level security;
alter table umsuka.transactions force row level security;
create policy "transactions_select_management" on umsuka.transactions for select to authenticated using (umsuka.is_management());
create policy "transactions_write_management" on umsuka.transactions for all to authenticated using (umsuka.is_management()) with check (umsuka.is_management());
```

- **Lectura y escritura solo para directiva**: difiere de `instruments` (lectura para todos). El resto de roles ve **0 filas** (invisible, no solo oculto) tanto vía API como vía queries directas.
- **No se crea `is_directiva()`**: se reutiliza `umsuka.is_management()` (0013) que ya cubre `super_admin, admin, board_member, event_manager` = `MANAGEMENT_ROLES` en `src/lib/auth/roles.ts`. Crear otro helper duplicaría la definición de directiva y arriesgaría divergencia (ver ADR-24 §D4, Alternativas D1).
- `FORCE RLS` + sin políticas para `anon` → fallback deny.

### D3 — Tipos hand-edited en `src/types/database.types.ts`

Añadidos `TransactionType`, `TransactionCategory`, `Tables.transactions` (Row/Insert/Update) y entrada `Functions.is_management`, más `Enums.transaction_type/transaction_category`. Sin CLI, la sincronía tipos↔migración se apoya en `tsc --noEmit` y el checklist manual.

### D4 — Zod isomórfico en `src/lib/finances/schema.ts`

- Constantes `TRANSACTION_TYPES / TRANSACTION_CATEGORIES` + `LABELS` es-ES para UI (Turno de barra, Compras de barra, ...).
- `createTransactionSchema`: `type`/`category` enums, `amount` `coerce.number().positive().max(99999999.99).refine(multipleOf 0.01)` (máx 2 decimales), `description` `optionalTrimmedText(2000)` (patrón instruments, `"" → null`), `transaction_date` `YYYY-MM-DD` validada con `isValidDateString` (regex + round-trip `toISOString` para rechazar 2026-02-30).
- `updateTransactionSchema` extiende con `id uuid`, `deleteTransactionSchema` solo `id uuid`.
- `filterSchema` con `type/category/from/to` opcionales y `refine(from <= to)` para rango inválido; `from/to` validadas con la misma `isValidDateString`.

### D5 — Queries en `src/lib/finances/queries.ts` (agregación en JS, sin `SECURITY DEFINER`)

- `getTransactions(filters)`: construye el builder encadenando `eq`/`gte`/`lte` y ordena por `transaction_date desc, created_at desc`; mapea `amount` con `Number()` para tolerar serialización `numeric` como string.
- `getTransactionById(id)`: `maybeSingle`, `null` si no existe o RLS lo filtra.
- `getSummary(filters)`: agregación en JS sobre `getTransactions` (totales, saldo `income - expense`, `byCategory` con `income/expense/count` por categoría), redondeando a 2 decimales. Patrón de `stats.ts`: asumible para <10k filas; si el volumen crece, migrar a función `SECURITY DEFINER` agregada (TODO documentado).
- `getMonthlyStats({ year, filters })`: construye 12 buckets `YYYY-MM` (enero→diciembre) del año pedido (default año actual), intersecta el rango del año con `from/to` del filtro, y reparte cada transacción por `transaction_date.slice(0,7)`. Devuelve siempre 12 entradas (vacías con 0 si no hay datos) para que la gráfica no tenga que manejar huecos. `buildEmptyYear` cubre el caso `from > to` (sin solape).
- `normalizeAmount` y `emptyByCategory` como helpers locales.

### D6 — Mutations + guards en `src/lib/finances/mutations.ts`

- `requireManagementGuard("Solo la directiva puede gestionar las finanzas.")` centraliza `requireAuthenticatedProfile()` + `isManagementRole(role)` (patrón votings/instruments) — fail-closed antes de tocar Supabase.
- `createTransaction(input)`: parse Zod → guard → `insert({ type, category, amount, description, transaction_date, created_by: actor.id }).select("id").single()`; `description "" → null`.
- `updateTransaction(input)`: parse → guard → `maybeSingle` existencia → `update` por `id`.
- `deleteTransaction(input)`: parse → guard → existencia → `delete().eq(id)`.
- Errores: violaciones de Zod se unen como `issues.map(m).join(", ")`; errores de Supabase se devuelven como `error.message` tal cual (no hay unique constraints esperadas que mapear a mensajes friendly, a diferencia de instruments).
- Superficie RLS probada en tests con `member` → rechazo sin llamada a `from`.

### D7 — Server actions thin en `src/lib/finances/actions.ts`

`"use server"` + 3 wrappers `createTransactionAction / updateTransactionAction / deleteTransactionAction` que delegan en `mutations.ts` y hacen `revalidatePath("/finances")` solo en éxito. Patrón de `src/app/instruments/actions.ts`.

### D8 — Página `/finances` con guard total y composición

`src/app/finances/page.tsx` — Server Component con `AppShell`:

- `getCurrentProfile()` → redirect a `/auth/login` si `null`; `isManagementRole(role)` → redirect a `/dashboard` si no es directiva (RLS ya garantiza 0 filas incluso si el guard se saltara; el redirect es solo UX).
- `searchParams` → `filterSchema.safeParse` (fallback a `{}` si inválido) → `Promise.all([getTransactions, getSummary, getMonthlyStats])` paralelo.
- Render: header con icono `Wallet`, `<FinanceSummaryCards summary />` (cards de ingresos/gastos/saldo con `Intl.NumberFormat es-ES EUR` + desglose por categoría con badges de conteo), `<MonthlyChart stats />` (barras CSS proporcionales al máximo anual, income verde / expense rojo, saldo coloreado, 12 meses siempre), sección "Registrar movimiento" con `<TransactionForm mode="create" />`, `<TransactionFilters />` (type/category/from/to → `router.push` con `URLSearchParams`, botón Limpiar), y `<TransactionList items />` con conteo.

Client components:

- `transaction-form.tsx`: form con selects de tipo/categoría (usando `TRANSACTION_*_LABELS`), `amount` `type="number" step="0.01"`, `date` picker, `description` con `maxLength 2000`, manejo de `isSubmitting` y `role="alert"` en errores, `router.refresh()` tras éxito.
- `transaction-filters.tsx`: estado local + `useTransition` + `router.push` con `URLSearchParams`.
- `finance-summary-cards.tsx`: 3 cards + grid de 5 categorías.
- `monthly-chart.tsx`: barras horizontales CSS, `maxValue` del año como denominador, highlight del mes actual, leyenda.
- `transaction-list.tsx`: lista con badges, importe coloreado, fecha `Intl.DateTimeFormat es-ES long`, descripción `whitespace-pre-line`, botones Editar/Eliminar con confirm `confirm()`, inline `TransactionForm` en modo edit, y empty state con borde dashed.

### D9 — Navegación: "Finanzas" solo para directiva

`src/components/layout/nav-links.ts` añade:

```ts
{ href: "/finances", label: "Finanzas", icon: Wallet, showFor: (ctx) => isManagementRole(ctx.role) }
```

entre Instrumentos y Mi perfil. `getVisibleLinks` ya filtra; `BottomNav` la hace deslizable (`overflow-x-auto`, `shrink-0`) sin cambios adicionales. No se añade regla extra en middleware: el guard de página + RLS son la barrera real (ningún módulo lo hace en middleware).

### D10 — Una migración (0062) + tipos, sin Supabase CLI

Sin CLI local, `src/types/database.types.ts` se edita a mano y la migración `20260101006200_finances.sql` incluye checklist manual pre-deploy (7 comprobaciones). Queda registrada como fila 0062 en `docs/DATABASE.md`.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| **Nueva función `umsuka.is_directiva()`** (prevista en el plan) | Duplicaría `umsuka.is_management()` (0013) que ya modela exactamente `super_admin, admin, board_member, event_manager` = directiva. Dos helpers con el mismo conjunto arriesgan divergencia futura (app vs BD). Ver ADR-24 §D4. |
| **RLS `SELECT` para todos + filtro en app** (patrón instruments) | Expondría datos financieros a todos los autenticados vía API directa, aunque el menú los oculte. El requisito exige invisibilidad real (0 filas para no directiva), no solo ocultar la entrada del menú. |
| **`transaction_date` como `timestamptz`** | Añadiría hora innecesaria para contabilidad de comparsa y obligaría a manejar zonas horarias en filtros y en la gráfica mensual (off-by-one). `date` simplifica el dominio. |
| **`amount` con signo (negativo = gasto)** | Mezclaría dos conceptos en una columna y obligaría a validar el signo contra `type`; separar `type` + `amount` positivo es más explícito y enlaza directo con el CHECK `amount > 0`. |
| **Librería de gráficas (recharts / chart.js)** | Añadiría dependencia y JS de cliente para una gráfica simple de 12 barras; el repo resuelve esto con barras CSS puras server/client (`results-chart.tsx`, `trend-chart.tsx`), bundle y mantenimiento mínimos. |
| **Agregación en SQL con función `SECURITY DEFINER`** | Prematura para <10k filas; la agregación en JS es trivialmente testeable y suficiente. Se deja documentado migrar a función agregada si el volumen lo exige. |

---

## Edge cases manejados

| Escenario | Comportamiento |
|---|---|
| Usuario no autenticado | `getCurrentProfile` → `null` → redirect a `/auth/login` (page guard); mutations lanzan `Se requiere autenticación.` vía `requireAuthenticatedProfile`. |
| Miembro sin directiva (`member`) accede a `/finances` | Redirect a `/dashboard`; aunque se saltara el guard, RLS devuelve 0 filas (SELECT y FOR ALL filtran con `is_management()`). Navegación: `Finanzas` no aparece (`showFor: isManagementRole`). |
| `member` llama a mutations | Rechazo temprano `Solo la directiva puede gestionar las finanzas.` sin tocar Supabase (test dedicado por mutación). |
| `amount` = 0, negativo o >2 decimales | Rechazado por Zod (`positive`, `multipleOf 0.01`); CHECK `amount > 0` en BD como defensa adicional. |
| `transaction_date` inválida (2026-02-30, formato no ISO) | Rechazada por `isValidDateString` (round-trip `toISOString`). |
| Descripción vacía o solo espacios | Normalizada a `null` (`optionalTrimmedText`); no se persiste cadena vacía. |
| `from` > `to` en filtros | Rechazado por `filterSchema.refine` → fallback a `{}` en la página; `getMonthlyStats` detecta `effectiveFrom > effectiveTo` y devuelve año vacío (12 buckets a 0). |
| Filtros sin resultados | `TransactionList` muestra empty state con borde dashed + mensaje "No hay transacciones…". |
| Año sin movimientos | `MonthlyChart` pinta 12 meses a 0 con `maxValue=1` (evita división por cero), saldo 0 €. |
| `numeric` serializado como string por Supabase | `normalizeAmount` vía `Number.parseFloat` (D5). |
| `created_by` es un perfil borrado | `ON DELETE SET NULL`: la transacción se conserva y `createdBy` queda `null`. |
| Re-ejecución de la migración | Idempotente: `DO ... duplicate_object`, `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `DROP POLICY IF EXISTS` + `DROP TRIGGER IF EXISTS` (D1/D2). |
| `anon` / `public` | Sin políticas para `anon` → fallback deny; además `is_management()` devuelve `false` para no autenticados. |

---

## Consecuencias

### Positivas

- **Cierre del ciclo de dinero**: la directiva controla ingresos/gastos por categoría, con resumen y estadísticas mensuales, sin salir de la app.
- **Invisibilidad real para no directiva**: RLS `is_management()` + guard de página + `showFor` en navegación — tres capas coherentes, ninguna filtración por API directa.
- **Denominador honesto del saldo**: `amount` positivo + `type` hacen `balance = income - expense` explícito, sin ambigüedad de signo.
- **Cero dependencias nuevas de UI**: barras CSS puras sin librería, patrón ya consolidado.
- **Suite nueva verde**: 36 tests nuevos (23 de schema + 13 de mutations) sobre una suite completa de **1276 tests en 87 archivos** (fue 1240/85).
- **IDs estables**: transacciones `uuid PK default gen_random_uuid()`, historial inmutable salvo DELETE explícito de directiva.

### Seguridad (defensa en profundidad)

- **Sin superficie `SECURITY DEFINER` nueva**: se reutiliza `is_management()` (0013) ya auditada; no se crea función adicional.
- **Grants correctos de `is_management`**: `GRANT EXECUTE` a `authenticated` (y `REVOKE` a `public` en 0013) siguen vigentes; la migración 0062 no los toca.
- **RLS `ENABLE + FORCE`** en `transactions`; el checklist manual verifica `pg_policies` (2 políticas, ambas `to authenticated`) y el fallback para `member` (0 filas) antes del deploy.
- **Fail-closed**: cualquier error de Supabase aborta la query/mutación con mensaje descriptivo; la página no pinta cifras parciales.

### Trade-offs aceptados / hallazgos conocidos

1. **Agregación en JS** (`getSummary` / `getMonthlyStats` leen todo el set filtrado y reducen en memoria): asumible para <10k filas; si la comparsa acumula años de movimientos, migrar a función agregada en SQL (patrón `my_workgroup_shift_average`).
2. **Hard DELETE**: `deleteTransaction` borra la fila físicamente (sin `deleted_at`). Decisión de producto vigente (DoD: "eliminar"); si se necesita auditoría, añadir `audit_logs` o soft-delete en sprint posterior.
3. **Sin paginación**: `getTransactions` devuelve todo el set filtrado ordenado; con >500 filas puede crecer la carga. Propuesta futura: `limit 200` + "Cargar más" si se detecta.
4. **`transaction_date` sin hora**: turnos nocturnos que cruzan medianoche se imputan al día contable elegido por la directiva, no a la hora exacta.
5. **Nueva categoría exige migración**: `ALTER TYPE umsuka.transaction_category ADD VALUE` debe ir en migración separada por la restricción transaccional de PG.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101006200_finances.sql` | CREATE — ENUMs `transaction_type`/`transaction_category`, tabla `umsuka.transactions` con CHECKs, índices, trigger `updated_at`, RLS directiva exclusiva (`is_management()`) + checklist manual |
| `src/types/database.types.ts` | MODIFY — edición manual: `TransactionType`, `TransactionCategory`, `Tables.transactions` (Row/Insert/Update), `Functions.is_management`, `Enums.transaction_type/transaction_category` |
| `src/lib/finances/schema.ts` | CREATE — Zod schemas `create/update/delete/filter`, helpers `isTransactionType/Category`, `LABELS` es-ES, `isValidDateString` |
| `src/lib/finances/queries.ts` | CREATE — `getTransactions`, `getTransactionById`, `getSummary`, `getMonthlyStats` (agregación JS, 12 buckets) |
| `src/lib/finances/mutations.ts` | CREATE — `create/update/deleteTransaction` con `requireManagementGuard` y `parseError` |
| `src/lib/finances/actions.ts` | CREATE — 3 server actions thin con `revalidatePath("/finances")` |
| `src/app/finances/page.tsx` | CREATE — página Finanzas: guard directiva + `searchParams` → `filterSchema` + `Promise.all` queries + composición de cards/gráfica/form/filtros/lista |
| `src/app/finances/transaction-form.tsx` | CREATE — form create/edit (selects tipo/categoría, amount `number`, date picker, `role="alert"`) |
| `src/app/finances/transaction-filters.tsx` | CREATE — filtros por tipo/categoría/from/to con `URLSearchParams` + `useTransition` |
| `src/app/finances/finance-summary-cards.tsx` | CREATE — 3 cards (ingresos/gastos/saldo) + desglose por 5 categorías con `Intl.NumberFormat es-ES EUR` |
| `src/app/finances/monthly-chart.tsx` | CREATE — barras CSS proporcionales al máximo anual (emerald/red), 12 meses + highlight del mes actual + leyenda |
| `src/app/finances/transaction-list.tsx` | CREATE — lista con badges, importe coloreado, fecha `es-ES long`, edición inline y borrado con confirm |
| `src/components/layout/nav-links.ts` | MODIFY — entrada `Finanzas` (`/finances`, icono `Wallet`, `showFor: isManagementRole`) |
| `tests/unit/lib/finances-schema.test.ts` | CREATE — 23 tests de Zod (tipos/categorías, amount, decimales, límites, fechas, labels, `filterSchema`) |
| `tests/unit/lib/finances-mutations.test.ts` | CREATE — 13 tests con chain-builder mock (guards antes de DB, Zod parse, `created_by` stamping, not-found, errores crudos) |
| `tests/unit/components/bottom-nav.test.tsx` | MODIFY — `super_admin` 16 → 17 secciones (Finanzas añadida) |
| `tasks/sprint-29-money-management.json` | CREATE — tarea del sprint (status `published`) |
| `docs/adr-sprint-29-money-management.md` | CREATE — este ADR |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/lib/finances-schema.test.ts` (CREATE) | 23 — `createTransactionSchema` (income válido, expense `other` con `""→null`, type/categoría inválidos, amount 0/negativo/`0.001`/max, coercion string, descripción 2000/2001 + `""→null`, `transaction_date` 2026-02-30 y vacío); `update` requiere `uuid`; `delete` uuid; `filterSchema` (vacío, from/to válidos, `from > to` rechazado, formato inválido, type/category opcionales) |
| `tests/unit/lib/finances-mutations.test.ts` (CREATE) | 13 — `create` rechaza `member` sin tocar DB, crea con `created_by`, normaliza `""→null`, rechaza Zod inválido, devuelve error crudo; `update` rechaza `member`, `not found`, actualiza con existencia, valida `uuid`; `delete` rechaza `member`, `not found`, borra, valida `uuid` |

**Verificado en local (2026-08-25):** `npx vitest run` → **1276 tests en 87 archivos, todos pasando** (36 nuevos en los dos archivos anteriores, 1 ajustado en `bottom-nav`); `npx tsc --noEmit` limpio; `npx eslint . --max-warnings=0` limpio; `npx next build` sin errores (ruta `/finances` 4.86 kB en el manifiesto). Security scan del pipeline (security-champion): CLEAR, 0 HIGH.

---

## Referencias

- Task file: `tasks/sprint-29-money-management.json` (criterios de aceptación, DoD — incluye este ADR como entregable; dependencias: Sprint 2 — Roles, Sprint 21 — Admin Panel, Sprint 3 — Barra).
- ADR-024 (Sprint 24 — Gestión de Instrumentos): §D4 — decisión de reutilizar `umsuka.is_management()` en lugar de crear `is_directiva`, patrón seguido por este sprint.
- Sprint 2 (Workgroup Roles) y `src/lib/auth/roles.ts` (`MANAGEMENT_ROLES`, `isManagementRole`): fuente de verdad en app para "directiva".
- Migración 0013 (`rls_policies.sql`): definición de `umsuka.is_management()` reutilizada por la RLS de 0062.
- `src/app/instruments/*` (pages, `instrument-form.tsx`, `queries.ts`, `mutations.ts`, `actions.ts`): patrón seguido por `lib/finances` y por `/finances`.
- `docs/DATABASE.md`: fila 0062 añadida (si existe tabla).
- Directivas globales: `docs/git-conventions.md` (rama `feature/sprint-29-money-management`, commits semánticos `feat(sprint-29)`/`test(sprint-29)`/`docs(sprint-29)`; PR y escaneo security-champion gestionados por el Publisher en el cierre del sprint).
