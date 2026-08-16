# ADR-015: Sprint 15 — Votaciones (Votings)

**Status:** Accepted · **Date:** 2026-08-16

---

## Context

El proyecto ya contaba con el esquema base de votaciones creado en las migraciones 0009/0010/0011 (`umsuka.votings`, `umsuka.voting_options`, `umsuka.voting_votes`), pero sin capa de aplicación ni UI: no había forma de crear una votación, votar o ver resultados desde la app. Este sprint implementa el módulo completo: capa `src/lib/votings/` (schemas Zod, queries, mutations), server actions con validación de rol, control de voto único, páginas `/votings`, `/votings/new` y `/votings/[id]` con gráfico de resultados, y tests.

Requisitos:

- Los management (roles `super_admin`/`admin`/`board_member`/`event_manager`) pueden crear votaciones con opciones y cerrarlas; cualquier miembro autenticado puede votar.
- Cada miembro puede votar **una sola vez** por votación.
- Los resultados se muestran **después de votar o al cerrar la votación** (no antes).
- Fecha límite opcional: al pasar, la votación se comporta como cerrada (sin nuevos votos, resultados visibles).
- Enlace de navegación «Votaciones» visible para **todos** los autenticados.
- NO se crea pull request en esta ronda: commit local en la rama `feature/sprint-15-votings` sin push (decisión del usuario).

### Restricciones heredadas

- La política RLS SELECT de `voting_votes` es **own-or-management**: un miembro regular solo puede leer sus propios votos, y management puede leer todos. Consecuencia directa: **la agregación de resultados en el cliente es imposible** para un miembro regular vía PostgREST — cualquier recuento global debe vivir en una función `SECURITY DEFINER`.
- La política INSERT de `voting_votes` de línea base solo comprobaba `user_id = auth.uid()`, lo que permitía a un cliente insertar un voto que referenciara una opción de **otra** votación (hallazgo de QA del sprint). Debía endurecerse.
- El unique constraint `(voting_id, user_id)` en `voting_votes` ya existía desde la migración 0011; no hay `allow_multiple` y no se añade.

---

## Decisión

### 1. Evolución de esquema — migración `20260101004900_votings_enhancement.sql`

- **`voting_deadline timestamptz` nullable** en `umsuka.votings`. Se eligió una columna nullable (no ENUM, no tabla aparte): sin deadline la votación queda abierta hasta el cierre manual; con deadline, el estado «abierta» se vuelve *efectivo* (ver sección 5). El `comment` de la columna documenta la semántica: mientras esté fijada y en el futuro la votación permanece efectivamente abierta; al pasar, se comporta como cerrada.
- **NO se añade `allow_multiple`.** El unique `(voting_id, user_id)` ya garantiza un voto por miembro, y el voto único (una sola opción) mantiene la aritmética de resultados simple: porcentajes sobre el total de votos, sin ponderaciones ni empates complejos.
- **Índice único parcial `idx_voting_options_voting_text_unique`** sobre `(voting_id, lower(option_text))`: impide opciones duplicadas sin distinguir mayúsculas a nivel de base de datos — defensa de fondo tras el refine case-insensitive del schema Zod (sección 3) y origen del mapeo 23505 en `createVoting`/`addOption`.
- Sin migración de datos semilla: el esquema sigue siendo 3NF y aditivo; ninguna tabla/columna existente se modifica ni elimina.

### 2. Resultados vía `SECURITY DEFINER` `umsuka.get_voting_results(uuid)`

- **Por qué:** la política SELECT de `voting_votes` (own-or-management) impide que un miembro regular lea los votos de todos para contarlos en el cliente; el recuento y los porcentajes deben calcularse en una función que se ejecute con los privilegios del definidor.
- La función es `stable`, de **solo lectura** (un solo `select` por fila de votación/opciones), con `set search_path = umsuka, public` (patrón del repo) y `grant execute ... to authenticated` (únicamente). Devuelve una fila por opción — **incluidas las opciones sin votos** — con `votes`, `total_votes` y `percentage` (un decimal, `round(count * 100.0 / v_total, 1)`, 0 cuando no hay votos), ordenadas por `option_text` asc.
- **Regla de visibilidad ejecutada server-side (defensa en profundidad):** si `is_open` AND (deadline nula OR `deadline > now()`) AND el llamante **no** ha votado AND el llamante no es management → la función retorna un **conjunto vacío** (los resultados quedan ocultos). La UI replica la misma regla con el helper puro `canViewResults` (sección 4); la RPC re-valida de todas formas qué puede ver el llamante, de modo que un cliente que llame a `get_voting_results` directamente no puede saltarse la regla.
- Tipos generados en `src/types/database.types.ts`: `get_voting_results` con `Args { p_voting_id }` y `Returns` del shape de una fila.

### 3. Capa `src/lib/votings/` — schemas, lógica pura, queries y mutations

- **`schema.ts` (Zod)** — `votingFormSchema` (compartido por el form y `createVotingSchema`):
  - Título: 1–200 caracteres (trim). Descripción: opcional, ≤ 5000.
  - `voting_deadline`: `z.string().datetime()` (ISO estricto) + `.refine(...)` de **futuro en creación** («La fecha límite debe ser en el futuro.»), nullable/opcional. El resolver del form normaliza los valores `datetime-local` a ISO **antes** de que corra esta validación (ver sección 5).
  - `options`: array de 2 a 20 strings (1–200 caracteres cada una), con `.refine` de **distintas sin distinguir mayúsculas** (`toLocaleLowerCase` + `Set`) — espejo de la regla del índice único de la BD. Constante `MAX_VOTING_OPTIONS = 20`.
  - `addOptionSchema` / `castVoteSchema` / `closeVotingSchema`: UUIDs válidos + `option_text` 1–200.
- **`logic.ts` (helpers puros, sin DB, unidad de testeo central)** — `isVotingOpenEffective`, `canViewResults`, `computeResults` (recuentos y porcentajes a un decimal, incluye opciones sin votos, ignora `option_id` desconocidos) y `normalizeDeadlineInput` (ver sección 5).
- **`queries.ts` (cliente anónimo, nunca elevado)**:
  - `getVotings()` — todas las votaciones (más nuevas primero) con conteo de opciones (dos queries + join en memoria, mismo patrón de módulos anteriores) y estado *efectivo* abierta/cerrada.
  - `getVotingById(id, userId?)` — detalle + opciones ordenadas alfabéticamente; cuando llega `userId` resuelve `hasVoted`/`chosenOptionId` (lectura de la propia fila, permitida por RLS own). Expone **`isOpenRaw`** (flag crudo `is_open`) además del estado efectivo, para que management pueda seguir cerrando votaciones cuyo deadline ya pasó (ver sección 5).
  - `getResults(votingId)` — invoca la RPC `get_voting_results` y mapea el shape a camelCase.
- **`mutations.ts` (patrón `lib/questions/`: `MutationResult`, `requireAuthenticatedProfile`, `isManagementRole`)** — todas con parse Zod antes de tocar la BD:
  - `createVoting` — guarda `requireManagementGuard` («Solo la directiva puede crear votaciones.»); inserta la votación (`is_open: true`) y sus opciones; si el insert de opciones falla hace **rollback best-effort** (delete de la votación para no dejar huérfanas); 23505 → «Ya existe una opción con ese enunciado.».
  - `addOption` — guarda management; re-chequea estado *efectivo* («La votación está cerrada.»); respeta el tope de 20 (`COUNT` previo); 23505 → «Esa opción ya existe.».
  - `castVote` — cualquier autenticado; `voting_id` sin votación → «Votación no encontrada.»; cerrada efectiva → «La votación está cerrada.»; **la opción debe pertenecer a la votación** (`eq("id", option_id)` + `eq("voting_id", voting_id)` → «La opción no pertenece a esta votación.»); pre-check de voto existente + mapeo de 23505 → «Ya has votado en esta votación.» (defensa ante carreras); **`user_id` siempre de `actor.id` (sesión), nunca del input**.
  - `closeVoting` — guarda management; `update({ is_open: false })`; sin votación → «Votación no encontrada.».

### 4. Regla de visibilidad de resultados (codificada dos veces)

Los resultados se muestran **cuando la votación ya no está efectivamente abierta, o el llamante ya votó, o el llamante es management**. Regla duplicada a propósito:

1. **App:** `canViewResults(voting, hasVoted, isManagement, now)` en `logic.ts`, usada por `/votings/[id]` para decidir si renderiza `ResultsChart` o el mensaje «Los resultados se muestran después de votar o al cerrar la votación.».
2. **BD:** la condición idéntica dentro de `get_voting_results` (sección 2), que devuelve un conjunto vacío en el caso oculto.

La página solo llama a `getResults(id)` cuando `revealResults` es true; la RPC es la segunda barrera para llamadas directas a la API.

### 5. Semántica de fecha límite

- **Entrada `datetime-local`** produce valores sin zona horaria (`"2026-03-01T23:59"`), que el check ISO-8601 de Zod rechaza. `normalizeDeadlineInput` los convierte **en el navegador** (zona local del usuario) a un ISO canónico con offset, espejando el patrón de `src/app/events/event-form.tsx`. Valores no parseables pasan sin cambios para que el schema genere su propio error (never silenciar la fecha).
- **Futuro solo en creación:** el `.refine` compara contra `Date.now()` con mensaje «La fecha límite debe ser en el futuro.». No hay restricción de futuro en `addOption` ni al votar (no aplica).
- **`isVotingOpenEffective` usa `>` estricto** (`deadline.getTime() > now.getTime()`), espejo exacto de la condición SQL `deadline > now()` de la función de resultados — misma regla, misma frontera.
- **Management puede cerrar una votación con deadline pasado:** `closeVoting` solo necesita el flag `is_open`; por eso `VotingDetail` expone `isOpenRaw` y la sección de gestión de la página se renderiza con `voting.isOpenRaw && canManage`. `addOption` en cambio re-chequea el estado *efectivo* y rechaza («La votación está cerrada.»): no se pueden añadir opciones a una votación vencida aunque `is_open` siga en true.

### 6. UI

- **`/votings`** — componente servidor con guarda de login; dos secciones (Activas / Cerradas) según el estado *efectivo*; badges con iconos (Vote/Lock), fecha `es-ES` y conteo de opciones; botón «Nueva votación» solo para management; estados vacíos diferenciados.
- **`/votings/new`** — guarda de login + `isManagementRole` (redirect a `/votings`). `voting-form.tsx` (cliente, RHF): `useFieldArray` para opciones dinámicas (2–20, botón eliminar bloqueado en 2, añadir bloqueado en 20), resolver que normaliza el deadline y mapea los errores de array de Zod (raíz y por índice) al shape que RHF entiende — puente entre el field-array `{ value: string }[]` y el schema de strings.
- **`/votings/[id]`** — guarda de login; `notFound()` si la votación no existe; form de voto (radios, `vote-form.tsx`) solo si abierta efectiva Y sin voto; aviso «Ya has votado por la opción “X”»; resultados (`results-chart.tsx`) u ocultos según `canViewResults`; gestión para management (solo lectura del aviso para el resto): `add-option-form.tsx` + `close-voting-button.tsx`.
- **`results-chart.tsx`** — **barras CSS puras** (div con ancho porcentual, clamp 0–100), sin librería de gráficos ni dependencia nueva.
- **Server actions** (`actions.ts`) — `createVotingAction`, `addOptionAction`, `castVoteAction`, `closeVotingAction` con `revalidatePath("/votings")` y `revalidatePath("/votings/[id]")` en éxito.
- **Navegación** — `nav-links.ts`: `{ href: "/votings", label: "Votaciones", icon: Vote }` **sin `showFor`** → visible para todos los autenticados (por defecto `AppShell`/`Sidebar`/`BottomNav` ya lo propagan).

### 7. Sin PR en esta ronda

Decisión del usuario recogida en el Definition of Done del task file: **commit local en la rama `feature/sprint-15-votings` sin push**. El PR se creará en una ronda posterior tras probar en local.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| `allow_multiple` (votar varias opciones) | `unique(voting_id, user_id)` ya garantiza un voto por miembro; el voto múltiple complicaría la aritmética de porcentajes y el diseño de resultados sin necesidad real. |
| Relajar la política SELECT de `voting_votes` (permitir leer todos los votos) | Expondría los votos de todos los miembros vía PostgREST y destruiría la privacidad del voto (la regla de ocultamiento se aplica después de votar); los resultados van por la función `SECURITY DEFINER`. |
| Agregación de resultados en el cliente | Imposible por RLS: un miembro regular no puede leer votos ajenos; solo una función con privilegios del definidor puede calcular el recuento global. |
| Librería de gráficos (recharts/chart.js) para los resultados | Dependencia nueva innecesaria para un formato de barras simple; CSS puro con ancho porcentual cubre el requisito sin coste. |
| Validar `is_open` efectivo (deadline) dentro de la política INSERT de `voting_votes` | No es fiable ni consistente evaluar `now()`/deadline de la votación referenciada en una política; se acepta el hueco como contenido (ver Consecuencias, nota MEDIUM b). |
| Un trigger/columna `closed_at` para el «cierre automático» | La regla efectiva (`is_open` + deadline) ya produce el comportamiento cerrado sin escrituras extra; un `closed_at` añadiría sincronización innecesaria. |

---

## Consecuencias

- **Suite completa verde: 653 tests en 45 archivos** (`npx vitest run`), todos pasando, sin regresiones. **68 tests nuevos**: 28 de `schema.test.ts` + 18 de `logic.test.ts` en `src/lib/votings/__tests__/`, y 22 de `tests/unit/lib/votings-mutations.test.ts` (mutations mockeadas con el patrón chain-builder de `shifts-mutations`).
- El voto único queda garantizado por **tres capas**: unique constraint en BD, pre-check en `castVote` y mapeo de 23505 (última defensa ante carreras).
- Los resultados quedan ocultos para no-votantes en votaciones abiertas con **doble barrera** (UI + función SQL); management siempre los ve; al cerrarse o vencer el deadline se muestran a todos.
- Se añaden al esquema: 1 columna nullable, 1 índice único parcial, 1 función `SECURITY DEFINER` y 1 política INSERT re-creada (endurecida) — **todo aditivo y compatible**; no se elimina ni modifica ninguna política de otras tablas.
- Sin migración de datos semilla; las filas existentes (si las hubiera) no se ven afectadas por `voting_deadline` (nullable).
- **Trade-offs aceptados (escaneo security-champion: CLEAN — 0 HIGH):**
  1. **MEDIUM (a) — `set search_path = umsuka, public` en `get_voting_results`:** patrón estándar del repo (mismo que `is_workgroup_lead`/`is_component_lead`). Aceptado: la función califica todos sus accesos con el esquema (`umsuka.votings%rowtype`, `umsuka.voting_votes`, …), es `stable` y de solo lectura, y el `grant execute` va **solo** a `authenticated`.
  2. **MEDIUM (b) — la política INSERT de `voting_votes` no verifica `is_open` efectivo a nivel de BD:** contenido y aceptado — no hay escalada de privilegios (solo inserta filas propias, con opción de la misma votación), el unique constraint impide el doble voto aunque el cliente llame a la API directamente, y la visibilidad de resultados está *gated* por `get_voting_results`. El chequeo de estado efectivo vive en la capa de aplicación (`castVote`).
  3. **LOW — mensajes `error.message` crudos** en algunos fallos inesperados: patrón consistente del repo.
  4. **LOW — rollback no transaccional en `createVoting`** (delete best-effort si falla el insert de opciones): aceptado; el único fallo plausible post-inserción es el 23505 de opciones duplicadas, ya bloqueado por el schema.
- Sin PR: commit local en `feature/sprint-15-votings` sin push (decisión del usuario).

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101004900_votings_enhancement.sql` | CREATE — `voting_deadline`, índice único case-insensitive, `umsuka.get_voting_results` (SECURITY DEFINER) + grant, política `voting_votes_insert_own` endurecida con `exists(voting_options)` |
| `src/lib/votings/schema.ts` | CREATE — schemas Zod (`votingFormSchema`, `addOptionSchema`, `castVoteSchema`, `closeVotingSchema`) + `MAX_VOTING_OPTIONS = 20` |
| `src/lib/votings/logic.ts` | CREATE — helpers puros `isVotingOpenEffective`, `canViewResults`, `computeResults`, `normalizeDeadlineInput` |
| `src/lib/votings/queries.ts` | CREATE — `getVotings`, `getVotingById` (con `hasVoted`/`chosenOptionId`/`isOpenRaw`), `getResults` vía RPC |
| `src/lib/votings/mutations.ts` | CREATE — `createVoting` (rollback best-effort), `addOption` (tope 20), `castVote` (23505 → «Ya has votado…»), `closeVoting` |
| `src/lib/votings/__tests__/schema.test.ts` | CREATE — 28 tests de validación de esquema |
| `src/lib/votings/__tests__/logic.test.ts` | CREATE — 18 tests de lógica pura |
| `tests/unit/lib/votings-mutations.test.ts` | CREATE — 22 tests de mutations con mocks |
| `src/app/votings/actions.ts` | CREATE — server actions con `revalidatePath` |
| `src/app/votings/page.tsx` | CREATE — lista activas/cerradas con badges y estados vacíos |
| `src/app/votings/new/page.tsx`, `new/voting-form.tsx` | CREATE — guarda management + form con `useFieldArray` (2–20 opciones, normalización de deadline) |
| `src/app/votings/[id]/page.tsx`, `vote-form.tsx`, `add-option-form.tsx`, `close-voting-button.tsx`, `results-chart.tsx` | CREATE — detalle, voto único, gestión de management y gráfico de barras CSS puro |
| `src/components/layout/nav-links.ts` | MODIFY — enlace «Votaciones» visible para todos los autenticados |
| `src/types/database.types.ts` | MODIFY — `voting_deadline` en `votings` Row/Insert/Update + tipos de la RPC `get_voting_results` |
| `tasks/sprint-15-votings.json` | CREATE — tarea del sprint |
| `docs/DATABASE.md` | MODIFY — ERD (`voting_deadline`), tabla de migraciones (0049), RLS de `voting_votes` y función `get_voting_results` |