# ADR-028: Sprint 28 — Estadísticas Personales (Personal Stats)

**Status:** Accepted (Implementado) · **Date:** 2026-08-24 · **Sprint:** 28 ·
**Branch:** `feature/sprint-28-personal-stats`

---

## Context

El apartado «Historial» del perfil era una página plana de tablas (asistencia y ausencias)
sin métricas. El Sprint 28 lo sustituye por una **sección de estadísticas personales**: cada
miembro ve sus porcentajes de asistencia a eventos, ensayos y turnos, su racha actual y
mejor racha, la tendencia mensual de los últimos 6 meses y una comparativa con la media de
su grupo de trabajo; la directiva ve además estadísticas agregadas en la página de cada
evento. Todas las métricas se calculan **en tiempo real** sobre los datos de asistencia
existentes, sin contadores desnormalizados.

Los datos viven repartidos en **tres fuentes** con modelos distintos (evento con fecha,
evento con sesión, turno con hora de inicio), lo que obliga a normalizarlas en un formato
común antes de poder agregar. Además, la RLS solo deja a cada miembro leer **sus propias
filas**, así que la media del grupo es incalculable en cliente y necesita una función SQL
dedicada que devuelva únicamente el agregado.

Requisitos (criterios de aceptación del task file):

- Cada miembro ve en su perfil: **% asistencia a eventos, % participación en ensayos,
  % asistencia a turnos, racha actual y mejor racha**.
- Las estadísticas se calculan **en tiempo real** sobre `attendance`,
  `rehearsal_attendance` y `workgroup_attendance`.
- **Tendencia mensual** (últimos 6 meses) mediante un mini-gráfico.
- **Comparativa con la media del grupo de trabajo** (solo con grupo asignado), sin exponer
  datos individuales de otros miembros.
- El apartado «Historial» se convierte en la sección **«Estadísticas»** conservando el
  detalle de asistencia/ausencias.
- Los responsables ven **estadísticas agregadas por evento** (presentes/ausentes/% y
  desglose por sesión en ensayos) en la página del evento.

Dependencias declaradas: **Sprint 5 (Asistencia)**, **Sprint 12 (Turnos)**,
**Sprint 17 (Eventos)** y **Sprint 27 (Ensayos)**.

La implementación vive en 7 commits sobre master: `aa145df` (función SQL + tipos),
`3e3b248` (helpers puros + tests), `bbd46e6` (queries), `76e6db7` (componentes de gráficas
CSS), `e74b81b` (página de estadísticas + redirect + navegación), `a40233b` (card de
estadísticas por evento) y `012ffed` (fix: buckets de la tendencia mensual en UTC).

### Estado previo

- **Fuentes de actividad**: `umsuka.attendance` (Sprint 5, una marca por evento),
  `umsuka.rehearsal_attendance` (Sprint 27, una marca por evento y **sesión**) y
  `umsuka.workgroup_attendance` (migración 0018, una marca por turno). Las tres filtran por
  `user_id` con RLS: nadie lee marcas ajenas.
- **`/profile/history`**: tablas de asistencia y ausencias sin métricas agregadas; card
  «Historial» en `/profile` con contadores sueltos.
- Patrones del repo reutilizados tal cual:
  - Gráficas con **barras CSS puras en server components**, patrón
    `src/app/votings/[id]/results-chart.tsx`.
  - Helper honesto de porcentajes de `src/lib/rehearsals/stats.ts`
    (`computeParticipationFromCounts`, 1 decimal, `null` si nada marcado).
  - Merge en JS con lookups batched para resolver fechas **sin N+1** (patrón
    `getEventComments` / `attendance/queries.ts`).
  - Migraciones hand-reasoned con checklist manual pre-deploy y edición manual de
    `src/types/database.types.ts` (sin Supabase CLI en el entorno).
- Última migración documentada en `docs/DATABASE.md`: 0058 (Sprint 27); este sprint usa
  **0060** (el número 0059 ya está ocupado por `user_preferences`, integrada vía PR del
  Sprint 25).

---

## Decisión

### D1 — Tasas por fuente y global: `attended / marked · 100`, 1 decimal, `null` si nada marcado

`src/lib/stats/stats.ts` concentra los helpers **puros** (sin imports de Supabase,
trivialmente testeables). `computeRate(attended, total)` devuelve
`Math.round((attended / total) * 1000) / 10` y **`null` cuando `total <= 0`**, para que la
UI renderice «—» en vez de un falso 0 %. Ejemplos verificados en tests: 2/3 → 66.7,
1/3 → 33.3, 4/4 → 100, 0/5 → 0, 0/0 → `null`.

`buildPersonalStats(eventMarks, rehearsalMarks, shiftMarks)` agrega las tres fuentes en un
bloque `PersonalStats`: tasa por fuente, **tasa global sobre la unión de todas las marcas**
(3 de 4 → 75), racha combinada y tendencia mensual. El denominador es siempre **honesto**:
solo filas marcadas (una sesión de ensayo que nadie marcó no existe como fila según el
modelo del Sprint 27, y por tanto jamás penaliza el porcentaje).

### D2 — Racha única combinada sobre marcas, no sobre días calendario

`computeStreaks(marks)` ordena internamente las marcas por fecha, recorre cronológicamente y
devuelve `{ current, best }`: `current` es la racha que termina en la última marca (0 si esa
marca fue falta) y `best` la más larga ever. Decisiones conscientes:

- La racha es **una sola, combinando las tres fuentes de actividad**, no una por fuente.
- Cuenta **marcas consecutivas, no días calendario**: una pausa larga entre actividades no
  rompe la racha (test: la racha sobrevive al cruce de año 31 dic → 2 ene).
- Ante empate de dos rachas, `best` reporta el máximo una sola vez.

### D3 — Tendencia mensual: últimos 6 meses con buckets claveados en UTC `YYYY-MM`

`computeMonthlyTrend(marks, { months = 6, now })` construye los buckets **oldest → newest
terminando en el mes actual**, con etiquetas estáticas es-ES (`ene`…`dic`) e inyectable
`now`/`months` para tests. Las marcas se agregan por el prefijo `YYYY-MM` de su fecha
(Postgres serializa los timestamps como strings ISO UTC, así que el prefijo es el mes UTC) y
la ventana se deriva con **getters UTC** (`getUTCFullYear`/`getUTCMonth`) para que ambos
lados sean consistentes sea cual sea la zona horaria del servidor — este encuadre fue el
fix `012ffed` tras un hallazgo MINOR de QA (ver Consecuencias). Comportamiento:

- Marcas fuera de la ventana: ignoradas.
- Bucket vacío: `rate` en `null` → el gráfico lo pinta como «no data», nunca como 0 %.
- Test de regresión dedicado: una marca a las 00:30 UTC del día 1 cae en su mes UTC aunque
  localmente aún sea el mes anterior.

### D4 — Lecturas solo propias, merge en JS, sin N+1

`getPersonalActivityMarks(userId)` (`src/lib/stats/queries.ts`) lanza en `Promise.all` las
tres consultas batched filtradas por `user_id` (la RLS lo exigiría igualmente; el filtro
explícito documenta la intención), y resuelve fechas con **dos lookups secundarios** también
batched (`events.in(id)` para las dos fuentes basadas en evento, `shifts.in(id)` para
turnos), omitidos por completo cuando no hay ids. El merge construye `ActivityMark[]`
(`{ date, attended }`):

- Asistencia genérica: `event_date` del evento, con **fallback a `created_at`** si el evento
  no aparece o no tiene fecha.
- Ensayos y turnos: fecha del evento / `start_time` del turno.
- Una marca cuya fecha no se puede resolver **se descarta**: sin fecha real corrompería
  silenciosamente rachas y tendencia.

Cualquier error de las cinco consultas lanza un mensaje descriptivo
(`Failed to fetch attendance/rehearsal attendance/workgroup attendance/events/shifts`):
fail-closed, el render aborta en lugar de pintar cifras parciales.

### D5 — Media del grupo: función `SECURITY DEFINER umsuka.my_workgroup_shift_average()`

La RLS de `workgroup_attendance` solo permite leer las filas propias, así que la media del
grupo es **imposible en cliente** sin abrir un agujero de privacidad. La migración
`20260101006000_workgroup_stats_average.sql` crea la función que la resuelve devolviendo
únicamente un escalar:

| Elemento | Definición |
|---|---|
| Firma | `my_workgroup_shift_average()` — **cero argumentos**, `returns numeric`, `language sql`, `stable`, `security definer`, `set search_path = umsuka, public` |
| Grupo del llamador | CTE `caller`: `profiles.id = auth.uid()`, `deleted_at is null`, `workgroup <> 'ninguno'` — sin perfil activo o sin grupo → `NULL` |
| Media | Promedio de las **tasas por miembro** (`100.0 * count(*) filter (where attended) / count(*)`, `round(..., 1)`) de los turnos marcados del grupo; quien no tiene turnos marcados no tiene tasa y se ignora; si nadie marcó, `NULL` |
| Comparación de grupo | `where a.workgroup::text = (select workgroup from caller)::text` — **casts explícitos a `text` en ambas partes**: la historia del esquema mezcla tipos (`profiles.workgroup` pasó a ser el ENUM `umsuka.workgroup` en 0020 mientras que `workgroup_attendance.workgroup` permaneció `text`), así que un `=` desnudo falla con `42883: operator does not exist: text = workgroup` según el estado real de cada columna. Comparar ambos lados como `text` replica el patrón de la migración 0040 (`s.workgroup::text = ...::text`) y es correcto bajo cualquier estado histórico |
| Privacidad | Agregado y devuelve **un único número**: ninguna fila ni PII de otros miembros cruza el límite; promediar tasas por miembro evita además que quien tiene muchos turnos marcados pese más que quien tiene pocos |
| Grants | `REVOKE EXECUTE` a `public` y `anon`, `GRANT EXECUTE` a `authenticated` |
| Idempotencia | `create or replace` + revoke/grant repetibles; `comment on function` documentado; checklist manual pre-deploy (6 comprobaciones, incluida la verificación de los casts `::text`) |

El consumo en `getMyWorkgroupShiftAverage()` es **fail-closed**: un error del RPC lanza un
error descriptivo (nunca se inventa un valor) y `null` queda reservado a los casos legítimos
sin datos; el `numeric` de Postgres puede llegar como número o como string numérico según la
serialización del driver, y se normaliza con `Number()`.

### D6 — Gráficas CSS puras en server components (sin librería)

`TrendChart` (`src/components/stats/trend-chart.tsx`) dibuja la tendencia como barras
verticales CSS: contenedor con `role="img"` y `aria-label` que resume los seis meses,
valor sobre cada barra, «···» y pista vacía cuando el mes no tiene datos, y altura
sujetada con `Math.min(100, Math.max(0, rate))` para que una tasa malformada no pueda
desbordar la pista. `ComparisonBars` (`comparison-bars.tsx`) compara turno propio contra
media del grupo con barras horizontales sujetadas a 0–100 y un mensaje de diferencia
calculado con `computeDelta(a, b)` (puntos porcentuales a 1 decimal, `null` si algún lado es
`null`): «Estás X puntos por encima de la media de tu grupo.» / «…por debajo…» / «Estás en
línea con la media de tu grupo.». Ambos siguen el patrón `results-chart.tsx` de votings:
cero dependencias nuevas, cero JavaScript de cliente.

### D7 — Nueva página `/profile/stats` y redirect desde `/profile/history`

`src/app/profile/stats/page.tsx` (server component con `AppShell`): guard
`getCurrentProfile` → redirect a login; obtiene marcas y media del grupo en un
`Promise.all`, calcula `buildPersonalStats` y completa con `getUserAttendance` /
`getUserAbsences` para el detalle. Estructura: 5 tiles KPI (% Eventos, % Ensayos,
% Turnos, Racha actual, Mejor racha), card «Tendencia (últimos 6 meses)», card
«Comparativa con mi grupo» **solo cuando `profile.workgroup !== 'ninguno'`**, y las tablas
de detalle que vivían en la página antigua (Historial de asistencia y Ausencias solicitadas,
con enlaces a eventos y badges Sí/No). `/profile/history` queda reducido a
`redirect("/profile/stats")`: la ruta sigue viva para bookmarks y enlaces antiguos.

### D8 — Navegación: «Mis estadísticas» y card «Estadísticas» en `/profile`

`nav-links.ts` añade `{ href: "/profile/stats", label: "Mis estadísticas", icon: Clock }`
(visible para todos, sin `showFor`) y `dashboard-nav.tsx` añade el mismo enlace. La etiqueta
es deliberadamente **«Mis estadísticas»**: «Estadísticas» ya existe apuntando a
`/workgroups` (estadísticas de gestión para super admin y leads) y los tests del bottom-nav
resuelven etiquetas con `getByText`, que exige unicidad. En `/profile`, la card pasa a
llamarse «Estadísticas» («Tu participación de un vistazo») y sus tiles enlazan a
`/profile/stats`, incluido el enlace «Ver estadísticas completas →».

### D9 — `EventStatsCard` para gestión en `/events/[id]`, sin queries extra

`event-stats-card.tsx` es un componente **presentacional** que recibe datos que la página ya
había cargado (`summary: AttendanceSummary | null`, `rehearsalRecords`,
`sessions: RehearsalSession[]`): cero consultas adicionales. Para eventos regulares muestra
«X presentes · Y ausentes · Z% de asistencia» con una barra apilada verde/roja (total mínimo
1 para mantener los segmentos definidos); para ensayos muestra la participación global
`n/m (r%)` más un badge por sesión (Mañana/Tarde) usando el helper del Sprint 27
`computeParticipationFromCounts` (1 decimal, «—» si nada marcado). El wiring en
`page.tsx` lo renderiza solo con permiso de gestión (`canManage`: management, o lead de
workgroup en los turnos creados por él mismo) dentro de las cards «Asistencia a ensayos» y
«Asistencia» ya existentes.

### D10 — Una migración (0060) + tipos hand-edited en `database.types.ts`

Sin Supabase CLI en el entorno, `src/types/database.types.ts` incorporó a mano la entrada
Functions `my_workgroup_shift_average: { Args: Record<string, never>; Returns: number | null }`,
que habilita el `supabase.rpc("my_workgroup_shift_average")` tipado consumido por
`queries.ts`. La migración 0060 es un único archivo (no hay `ADD VALUE` de por medio, así que
no hace falta dividirla como en el Sprint 27) y sigue el patrón hand-reasoned con checklist
manual pre-deploy; queda registrada en `docs/DATABASE.md`.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| **Media del grupo calculada en cliente** (leer las filas del grupo y promediar) | Imposible sin agujero de privacidad: la RLS de `workgroup_attendance` solo deja leer filas propias, y abrir SELECT de lectura a todo el grupo expondría las marcas individuales de otros miembros. La función `SECURITY DEFINER` resuelve el caso entregando únicamente el escalar agregado. |
| **Vista (o vista materializada) para la media del grupo** | Una vista con `security_invoker` seguiría filtrando filas ajenas (media imposible); una materializada expondría tasas por miembro salvo que se agregara con cuidado, además de exigir refresco programado (datos stale). La función devuelve un escalar siempre fresco, con grants propios y sin superficie extra. |
| **Librería de gráficas (p. ej. recharts)** | Añadiría dependencia y componentes de cliente para dos gráficas simples; el repo ya resuelve esto con barras CSS puras server-rendered (`results-chart.tsx` de votings). Bundle y mantenimiento mínimos. |
| **Contadores incrementales (tasas y rachas precalculadas al marcar)** | Los criterios exigen cálculo en tiempo real sobre las tablas existentes; desnormalizar crearía deriva (limpiezas de sesión, borrados, cambios de marca) y obligaría a tocar todos los flujos de escritura de los Sprints 5/12/27. Las lecturas batched son O(marcas propias del miembro), trivialmente asumibles. |

---

## Edge cases manejados

| Escenario | Comportamiento |
|---|---|
| Miembro sin ninguna marca en una fuente | `computeRate` → `null` → la UI pinta «—», jamás un falso 0 % (D1) |
| Sesión de ensayo / turno / evento sin marcar | No existe como fila: no entra en el denominador (denominador honesto, D1) |
| Marca sin fecha resoluble (evento o turno inexistente, o sin fecha) | Descartada del merge (`buildMarks`): sin fecha real corrompería rachas y tendencia (D4); la asistencia genérica cae primero a `created_at` como fallback |
| Error de BD en cualquiera de las 5 consultas o en el RPC | Throw descriptivo (`Failed to fetch …`): el render aborta, nunca se pintan cifras parciales (fail-closed, D4/D5) |
| `numeric` del RPC serializado como string | Normalizado con `Number()` (D5) |
| Perfil soft-deleted o workgroup `'ninguno'` | La función SQL devuelve `NULL`; además la card de comparativa ni se monta en `/profile/stats` (D7) |
| Nadie del grupo con turnos marcados | Media `NULL` → «Tu grupo aún no tiene turnos marcados para comparar.» |
| Llamador con turnos marcados pero grupo sin datos | «Aún no tienes turnos marcados.» / «Tu grupo aún no tiene turnos marcados…» según el lado faltante (early returns de `ComparisonBars`, D6) |
| Delta positivo / negativo / cero | «Estás X puntos por encima…» / «…por debajo…» / «Estás en línea con la media de tu grupo.» (D6) |
| Mes de la ventana sin marcas | Bucket con `rate` null → «···» y pista vacía: «no data» ≠ 0 % (D3) |
| Marcas fuera de los últimos 6 meses | Ignoradas por la tendencia (fuera de ventana) |
| Marca en el borde de mes con TZ local distinta de UTC | Ventana y claves encuadradas en UTC: la marca cae en su mes UTC correcto (fix `012ffed`, test de regresión) |
| Marcas de entrada desordenadas | `computeStreaks` ordena internamente por fecha antes de contar (D2) |
| Dos rachas empatadas como mejor | `best` reporta el máximo una sola vez (test dedicado) |
| `anon`/`public` invocando el RPC | Rechazado (permission denied): solo `authenticated` tiene EXECUTE (checklist manual de 0060) |
| Re-ejecución de la migración 0060 | Idempotente: `create or replace` + revoke/grant repetibles |
| Bookmark antiguo a `/profile/history` | Redirect a `/profile/stats`: la ruta sigue viva (D7) |

---

## Consecuencias

### Positivas

- **Vista 360° del miembro**: tasas por fuente, tasa global, racha combinada, tendencia de 6
  meses y comparativa con el grupo — todo calculado en tiempo real sobre las tablas
  existentes, sin contadores que derivar ni jobs de refresco.
- **Comparativa de grupo sin exponer filas ajenas**: la única pieza con privilegios
  elevados es una función que devuelve un escalar; el resto lee exclusivamente filas
  propias.
- **Denominador honesto en todas las métricas**: `null` = nada marcado → «—»; un mes o una
  fuente sin datos jamás se pintan como 0 %.
- **Cero dependencias nuevas de UI**: barras CSS puras en server components, patrón ya
  consolidado por `results-chart.tsx`; accesibles (`role="img"` con resumen textual).
- **URLs estables**: `/profile/history` redirige a `/profile/stats`; la navegación nueva
  convive sin colisiones de etiquetas con la existente.
- **Suite nueva verde**: 36 tests nuevos (22 helpers puros + 14 queries) sobre una suite
  completa de **1240 tests en 85 archivos**.

### Seguridad (defensa en profundidad)

- Superficie `SECURITY DEFINER` **intencionalmente mínima**: cero argumentos, `stable`,
  devuelve un único `numeric` agregado — ninguna fila ni PII de otros miembros cruza el
  límite; `search_path` pineado a `umsuka, public` contra hijacking de esquemas.
- **Grants correctos**: `REVOKE EXECUTE` a `public` y `anon`; solo `authenticated` puede
  ejecutar la función (verificado en el checklist manual pre-deploy).
- **Lecturas de marcas limitadas a filas propias**: `eq("user_id", …)` explícito sobre las
  tres tablas + RLS preexistente; ningún código nuevo ensancha políticas.
- **Fail-closed end-to-end**: cualquier error de consulta o RPC aborta el render en lugar de
  mostrar cifras parciales o inventadas; el grupo del llamador se resuelve dentro de la
  propia función desde `auth.uid()`, nunca desde parámetros del cliente.
- Security scan del pipeline (security-champion): **CLEAR — 0 HIGH**.

### Trade-offs aceptados / hallazgos conocidos

1. **Buckets UTC en la tendencia**: un usuario en una zona horaria detrás de UTC puede ver
   una marca de madrugada del día 1 en el mes anterior al local. Es el precio de enmarcar
   ventana y claves de forma consistente con la serialización UTC de Postgres (fue
   precisamente el bug inverso el que detectó QA y corrigió `012ffed` con test de
   regresión).
2. **Comparativa limitada a turnos**: la media del grupo cubre `workgroup_attendance`;
   extenderla a eventos y ensayos exigiría funciones análogas. Documentado como trabajo
   futuro.
3. **Rachas por marcas, no por días**: una inactividad prolongada no rompe la racha.
   Decisión de producto consciente para actividades de calendario irregular.
4. **Recálculo por request**: tasas, rachas y tendencia se computan en cada visita de la
   página. Coste O(marcas propias del miembro), asumible frente a la complejidad de
   contadores desnormalizados.
5. **SQL hand-reasoned y tipos manuales**: sin Supabase CLI, la migración incluye checklist
   manual pre-deploy y la sincronía tipos↔función se apoya en `tsc` y en los tests del RPC.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101006000_workgroup_stats_average.sql` | CREATE — `umsuka.my_workgroup_shift_average()` (agregado escalar del grupo, search_path pineado, REVOKE public/anon + GRANT authenticated, idempotente) + checklist manual |
| `src/types/database.types.ts` | MODIFY — edición manual (sin CLI): entrada Functions `my_workgroup_shift_average` (`Args: Record<string, never>`, `Returns: number \| null`) |
| `src/lib/stats/stats.ts` | CREATE — helpers puros `computeRate`, `computeStreaks`, `computeMonthlyTrend` (buckets UTC `YYYY-MM`), `buildPersonalStats`, `computeDelta` + tipos `ActivityMark`, `Streaks`, `MonthlyTrendPoint`, `PersonalStats` |
| `src/lib/stats/queries.ts` | CREATE — `getPersonalActivityMarks` (3 fuentes batched + 2 lookups, merge en JS sin N+1, marcas sin fecha descartadas) y `getMyWorkgroupShiftAverage` (RPC fail-closed con coerción `Number()`) |
| `src/components/stats/trend-chart.tsx` | CREATE — barras verticales CSS, `role="img"` con resumen, `null` → «···», alturas sujetadas |
| `src/components/stats/comparison-bars.tsx` | CREATE — barras horizontales propias vs media del grupo + mensajes de delta (`computeDelta`) |
| `src/app/profile/stats/page.tsx` | CREATE — página Estadísticas: KPIs, tendencia, comparativa (solo con grupo) y tablas de historial de asistencia/ausencias |
| `src/app/profile/history/page.tsx` | MODIFY — reducida a `redirect("/profile/stats")` (bookmarks y enlaces antiguos siguen funcionando) |
| `src/app/profile/page.tsx` | MODIFY — card renombrada «Estadísticas» con tiles enlazando a `/profile/stats` y «Ver estadísticas completas →» |
| `src/components/layout/nav-links.ts` | MODIFY — entrada «Mis estadísticas» (`/profile/stats`, icono Clock, visible para todos) |
| `src/components/layout/dashboard-nav.tsx` | MODIFY — enlace «Mis estadísticas» |
| `src/app/events/[id]/event-stats-card.tsx` | CREATE — card agregada para gestión (totales presentes/ausentes/% y desglose por sesión en ensayos), solo presentacional |
| `src/app/events/[id]/page.tsx` | MODIFY — wiring de `EventStatsCard` en las cards de gestión «Asistencia a ensayos» y «Asistencia», reutilizando datos ya cargados |
| `tasks/sprint-28-personal-stats.json` | CREATE — tarea del sprint |
| `docs/DATABASE.md` | MODIFY — fila de migración 0060 en la tabla de migraciones |
| `docs/adr-sprint-28-personal-stats.md` | CREATE — este ADR |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/lib/stats-stats.test.ts` (CREATE) | 22 — `computeRate` (`null` con total ≤ 0, 0 %, 100 %, redondeo 2/3 → 66.7 y 1/3 → 33.3); `computeStreaks` (lista vacía, todo asistido, reset conservando `best`, racha en curso tras fallo, orden interno, cruce de año, empate de máximos); `computeMonthlyTrend` (6 buckets oldest→newest con etiquetas es-ES, reloj real en UTC, meses custom, marcas fuera de ventana, buckets vacíos `null` + agregación, encuadre UTC en el borde de mes — regresión `012ffed`); `buildPersonalStats` (tasas por fuente + global 75 %, racha combinada, passthrough de opciones, input vacío todo `null`); `computeDelta` (`null` con algún lado `null`, resta a 1 decimal con negativos) |
| `tests/unit/lib/stats-queries.test.ts` (CREATE) | 14 — `getPersonalActivityMarks`: filtro `user_id` en las 3 tablas, join de fechas/horas con fallback `created_at`, descarte de marcas sin fecha, lookups omitidos sin ids, tolerancia a `data` null, throw ante error en cada una de las 5 consultas; `getMyWorkgroupShiftAverage`: una llamada rpc con coerción de string numérica, números intactos, `null` sin data, throw descriptivo ante error |

**Verificado en local (2026-08-24):** `npx vitest run` → **1240 tests en 85 archivos, todos
pasando** (36 nuevos en los dos archivos anteriores); `npx tsc --noEmit` limpio;
`npx eslint . --max-warnings=0` limpio; `npx next build` sin errores (verificado dos veces,
última el 2026-08-24). QA review aprobado (todos los criterios de aceptación PASS) tras
corregir el hallazgo MINOR de bucketing local-vs-UTC en la tendencia mensual (commit
`012ffed`, con test de regresión). Security scan del pipeline (security-champion): CLEAR,
0 HIGH. Ciclo de vida del task file: created → planned → implemented → validated
(qa-reviewer) → security-cleared → documented → published.

---

## Referencias

- Task file: `tasks/sprint-28-personal-stats.json` (criterios de aceptación, DoD — incluye
  este ADR como entregable; dependencias: Sprint 5 — Asistencia, Sprint 12 — Turnos,
  Sprint 17 — Eventos, Sprint 27 — Ensayos).
- ADR-027 (Sprint 27 — Asistencia a Ensayos): modelo de `rehearsal_attendance` que da el
  denominador honesto por sesiones marcadas y el helper `computeParticipationFromCounts`
  reutilizado por `EventStatsCard`.
- Sprint 5 (Asistencia), Sprint 12 (Turnos) y Sprint 17 (Eventos): las tres fuentes de
  marcas (`attendance`, `workgroup_attendance`, `events`) leídas por
  `getPersonalActivityMarks`.
- `src/app/votings/[id]/results-chart.tsx`: patrón de barras CSS puras seguido por
  `TrendChart` y `ComparisonBars`.
- Migración 0018 (`workgroup_attendance`): tabla cuyo RLS motivó la función
  `SECURITY DEFINER` de 0060.
- `docs/DATABASE.md`: fila 0060 añadida a la tabla de migraciones.
- Directivas globales: `docs/git-conventions.md` (rama
  `feature/sprint-28-personal-stats`, commits semánticos
  `feat(sprint-28)`/`fix(sprint-28)`; PR y escaneo security-champion gestionados por el
  Publisher en el cierre del sprint).
