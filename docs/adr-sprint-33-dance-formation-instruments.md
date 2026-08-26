# ADR-033: Sprint 33 — Posicionamiento de Bailarinas e Instrumentos de Músicos

**Status:** Accepted (Implementado) · **Date:** 2026-08-26 · **Sprint:** 33 ·
**Branch:** `feature/sprint-33-dance-formation-instruments`

---

## Context

Permitir ordenar a las **bailarinas por posición** en una vista gráfica tipo **asientos de avión** donde cada fila tiene **6 posiciones (3-3 con pasillo central)** y asignar/arrastrar personas del grupo de baile a cada asiento. Además, para cada **músico** asignar un **instrumento del inventario (Sprint 24)** que tocará en el desfile/ensayo. La directiva y el super_admin gestionan la formación; todos los miembros pueden consultarla. Incluye formación ligada opcionalmente a evento, drag & drop, validación de componente, y export/print.

Requisitos (`tasks/sprint-33-dance-formation-instruments.json`):
- Filas de 6, rejilla con pasillo central.
- Asignar bailarina a asiento vacío vía drag & drop o selección.
- Mover bailarina entre asientos y quitarla.
- Única bailarina por asiento y por formación (validación + UNIQUE).
- Solo directiva/super_admin edita; resto consulta (RLS + guards).
- Cada músico un instrumento del inventario, validando disponibilidad.
- Formación ligada a evento y visualizable en su detalle.
- Plano exportable/imprimible.

Dependencias: Sprint 2 (component_type music/dance), Sprint 17 (eventos — formation event_id), Sprint 24 (instruments), Sprint 19 (profiles).

Última migración antes del sprint: `20260101006600_rehearsal_attendance_service_role.sql`; este sprint añade **0067** `dance_formation_instruments` (0066 ya ocupada por fix service_role; 0065 era la última funcional documentada en el task).

### Corrección SDD: `workgroup` vs `component_type` (ADR-032)

`plan-desarrollo-completo.md` §Sprint 33 dice *"workgroup = baile/dance, música/music"*. Falso: `Workgroup = telas|barra|estandarte|limpieza|ninguno` vs `ComponentType = music|dance|member` (`database.types.ts:9-14`). **Decisión:** filtrar por `profiles.component_type='dance'` para bailarinas y `'music'` para músicos; validación en Zod + mutations + queries espeja RLS. Si se usara `workgroup`, bailarinas/músicos con `workgroup=ninguno` quedarían excluidos (0 resultados) aunque pertenezcan al componente correcto. Documentado en migración.

---

## Decisión

### D1 — Tablas `dance_formations`, `dance_positions`, `musician_instruments`

```sql
create table umsuka.dance_formations (
  id uuid pk default gen_random_uuid(),
  name text not null check (char_length 1-200),
  event_id uuid fk events SET NULL,
  created_by uuid fk profiles SET NULL,
  created_at timestamptz default now()
);
create table umsuka.dance_positions (
  id uuid pk, formation_id fk CASCADE, row_number int >=1,
  seat_number int 1-6, member_id fk SET NULL, created_at
);
create table umsuka.musician_instruments (
  id uuid pk, user_id fk CASCADE, instrument_id fk CASCADE,
  formation_id fk CASCADE null, assigned_by SET NULL, assigned_at
);
```

- `dance_formations.event_id SET NULL` preserva formación base al borrar evento; `NULL` = formación reutilizable.
- `dance_positions` modela una fila por asiento ocupado; `member_id NULL` permitiría placeholder vacío pero el app-layer solo crea filas para asientos ocupados (sparse).
- `musician_instruments` nueva tabla; no se extiende `instrument_assignments` del Sprint 24 (ver D2).

### D2 — Nueva tabla `musician_instruments` vs extender `instrument_assignments`

`instrument_assignments` mantiene semántica histórica *"un responsable por instrumento"* con partial UNIQUE `(instrument_id) WHERE unassigned_at IS NULL`; cierre lógico (`unassigned_at`). `musician_instruments` modela *"un instrumento por músico por formación"* con `UNIQUE(user_id,formation_id) WHERE formation_id NOT NULL` + `UNIQUE(user_id) WHERE formation_id IS NULL` + `UNIQUE(instrument_id,formation_id)`. Separar evita contaminar histórico, permite `formation_id NULL` = asignación base global, y evita migración destructiva del índice parcial existente. Alternativa descartada: `instrument_assignments + formation_id` acoplaría ciclos de vida distintos.

### D3 — Grid 6 fijos (3+pasillo+3), CHECK y UNIQUE asiento/miembro

- `CHECK seat 1-6`, `CHECK row >=1`, `UNIQUE(formation,row,seat)` y `UNIQUE(formation,member) WHERE member NOT NULL`. Garantizan invariantes a nivel DB.
- UI: CSS grid con `w-8` central como pasillo visual; cada asiento `SeatCard` con avatar/nombre o vacío; drag&drop con `@dnd-kit` si disponible + fallback click-to-assign/move/swap para accesibilidad y por no añadir deps (proyecto no lista `@dnd-kit`).

### D4 — Filtrado por `component_type` espeja DB y app-layer

Queries `getAvailableDancers()` filtra `component_type='dance'`, músicos `'music'`, `is_active`, `status='active'`, `deleted_at IS NULL`. Mutations re-validan `component_type` fail-closed antes de cualquier write; mensaje es-ES *"Solo bailarinas del grupo de baile..."* / *"Solo músicos..."*. Nunca se consulta `workgroup`.

### D5 — RLS `is_management()` para write, `authenticated` para read

```sql
ENABLE ROW LEVEL SECURITY; FORCE;
CREATE POLICY select_authenticated ON ... FOR SELECT TO authenticated USING (true);
CREATE POLICY write_management   ON ... FOR ALL TO authenticated USING (is_management()) WITH CHECK (is_management());
```

- Sin `SECURITY DEFINER` nuevo; reutiliza `umsuka.is_management()` (super_admin/admin/board_member/event_manager, 0013).
- Grants a `authenticated` + `service_role` (bypass para admin client si se usara). Member INSERT sin management → `42501 violates RLS`.
- Guards `requireManagementGuard` fail-closed vía `requireAuthenticatedProfile` + `isManagementRole` en mutations/actions (mismo patrón que `instruments/mutations.ts`, `rehearsals/auto-enroll.ts`).

### D6 — Idempotencia y manejo de duplicados fail-closed

- UNIQUE asiento + UNIQUE miembro son defensa final contra carreras; mutations mapean `23505` → mensajes es-ES (*"El asiento ya está ocupado."*, *"La bailarina ya está asignada..."*), `23503` → *"La formación no existe."*.
- `moveDancer` implementa swap sin violar UNIQUE seat: intercambia `member_id` (no coordenadas) con clear temporal a `NULL` para evitar colisión de `UNIQUE(member)` intermedia; move a vacío mueve coordenadas o reasigna `member_id` al placeholder y borra origen.

### D7 — Instrumentos disponibles = `is_active` y no asignado en formación

`getAvailableInstruments(formationId)` lista `instruments` activos y filtra los ya asignados en `musician_instruments` para esa formación (o base si `NULL`). `assignInstrumentToMusician` valida `is_active` y que el instrumento no esté ocupado en esa formación; si el usuario ya tiene instrumento en esa formación, lo actualiza (cambio de instrumento) en vez de duplicar.

### D8 — Duplicación de formación (clone)

`duplicateFormation(formationId)` crea `"${name} (copia)"` con `event_id NULL`, copia todas las posiciones y asignaciones de músicos con nuevo `formation_id`. Operación solo management; útil para reutilizar plano base en nuevo evento.

### D9 — Export/print

Botón `window.print` + `@media print` (`print:hidden` y `zoom`). Sin nueva dependencia `html2canvas`/`jspdf` por simplicidad; suficiente para MVP y evita bundle extra.

### D10 — Capa thin `actions.ts` con `revalidatePath('/formation','/events')`

Wrappers `use server` que delegan a mutations y revalidan rutas de formación y eventos. Patron thin de `finances/actions.ts`.

---

## Alternativas consideradas

| Alternativa | Por qué se descartó |
|---|---|
| Reutilizar `instrument_assignments` añadiendo `formation_id` | Acopla ciclos de vida distintos; migra índice parcial activo `WHERE unassigned_at IS NULL` de forma destructiva; histórico vs formación confundidos. |
| Filtrar bailarinas/músicos por `workgroup` (`telas/barra...`) | Valores no contienen `music/dance`; `workgroup` es grupo de trabajo logístico, `component_type` es componente artístico. ADR-032 corrige. |
| Crear ENUM `seat_number` / trigger para 6 fijos | Sobrecarga; `CHECK 1-6` es suficiente y extensible si algún día cambia. |
| Añadir `SECURITY DEFINER` para lecturas complejas | No necesario; reads son `SELECT true` para authenticated; joins de perfiles se hacen en JS (2 queries, merge) como `instruments/queries.ts`. |
| Grid drag solo con click o solo con dnd-kit | Soporte dual: click es accesible por teclado y sin deps; dnd-kit se usaría si se instalara, fallback garantiza funcionalidad. |

---

## Consecuencias

- Positivo: invariantes a nivel DB, RLS estricta, validación espejada, UI accesible, sin nuevas deps, coexistencia limpia con Sprint 24, migraciones idempotentes.
- Negativo: `moveDancer` swap requiere 3 updates secuenciales (no transacción explícita); riesgo bajo por bajo volumen y guard `member_id NULL` intermedio. Auto-enroll futuro no interfiere (formaciones no son ensayos).

---

## Edge cases y trade-offs

- Asiento origen vacío en `moveDancer` → error es-ES; origen=destino → error.
- Bailarina ya colocada → `UNIQUE(member)` + check previo → mensaje amigable.
- Instrumento inactivo → rechazo antes de insert.
- Instrumento ocupado en formación → `23505` → mensaje; global base (`formation_id NULL`) solo uno por músico/instrumento.
- Formación sin posiciones (vacía) → grid muestra 3 filas vacías por UX.

---

## Verificación

Ver checklist idempotente en migración `20260101006700` (15 puntos): CHECKs, UNIQUEs, índices, `RLS ENABLE+FORCE`, `SELECT true` vs `ALL is_management()`, `service_role` grants, re-run idempotente (`IF NOT EXISTS`, `DO pg_policies` guards), comentarios `pg_description`.

---

## Cambios

- `supabase/migrations/20260101006700_dance_formation_instruments.sql` — CREATE.
- `src/types/database.types.ts` — nuevas Tablas `dance_formations`, `dance_positions`, `musician_instruments` + Relationships.
- `docs/DATABASE.md` — filas 0066/0067.
- `src/lib/formation/schema.ts` — Zod + constantes + helpers.
- `src/lib/formation/queries.ts` — `getFormations`, `getFormationById`, `getAvailableDancers`, `getAvailableInstruments`, `getMusicianInstruments`, `getFormationByEventId`.
- `src/lib/formation/mutations.ts` — 7 mutations con guards.
- `src/lib/formation/actions.ts` — thin wrappers.
- `src/components/formation/DanceFormationGrid.tsx` — grid 3+pasillo+3, panel sin asignar, readOnly, print.
- `src/components/formation/MusicianInstrumentList.tsx` — selector instrumentos disponibles.
- `src/app/formation/page.tsx` + `src/app/formation/[id]/page.tsx` — listado/creación/tabs y detalle.
- `src/app/events/[id]/page.tsx` — embed readOnly si `event_id` ligada.
- `tests/unit/lib/formation-schema.test.ts` — 21 tests.

Todos los tests (`npx vitest run` 1405), `tsc --noEmit` y `eslint` limpios, `next build` sin errores.

---

## Referencias

- `tasks/sprint-33-dance-formation-instruments.json`
- `tasks/plan-desarrollo-completo.md` §Sprint 33
- `supabase/migrations/20260101003200_shifts_enhancement.sql` (patrón FK índices)
- `supabase/migrations/20260101005800_rehearsal_attendance.sql` (RLS pattern)
- `src/lib/instruments/*` (historial vs activo)
