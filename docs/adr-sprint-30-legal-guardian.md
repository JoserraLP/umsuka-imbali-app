# ADR-030: Sprint 30 — Representante Legal para Menores de Edad (Legal Guardian)

**Status:** Accepted (Implementado) · **Date:** 2026-08-26 · **Sprint:** 30 ·
**Branch:** `feature/sprint-30-legal-guardian`

---

## Context

La comparsa necesitaba permitir que un perfil menor de edad tenga un representante legal asociado. El representante puede ser otro componente de la comparsa (`is_member=true + member_user_id`) o una persona externa dada de alta con datos de contacto. Solo directiva (`super_admin`, `admin`, `board_member`, `event_manager`) gestiona los vínculos; el representante con cuenta puede ver a los menores que representa.

Requisitos (acceptance criteria `tasks/sprint-30-legal-guardian.json`):

- Un perfil puede marcarse como menor (`is_minor boolean`).
- Todo menor debe tener representante asignado (obligatorio al registrarse o asignado luego por directiva).
- Representante interno o externo unificado en una tabla.
- Representante miembro ve información del menor.
- Directiva gestiona creación/edición/asignación/desasignación y `is_minor`.
- RLS + guards garantizan que solo directiva gestiona y representante ve solo sus menores.

Dependencias: Sprint 6 (Registration Approval), Sprint 19 (Perfiles), Sprint 14 (Listado Miembros), Sprint 2 (Roles).

Patrones reutilizados: RLS `ENABLE+FORCE` + `is_management()` (0013), Zod isomórfico `optionalTrimmedText`, `MutationResult` + `requireManagementGuard`, server actions thin con `revalidatePath`, `database.types.ts` hand-edited + checklist.

Última migración: `20260101006200_finances.sql`; este sprint usa **0063**.

---

## Decisión

### D1 — FK `profiles.legal_guardian_id -> legal_guardians` (1:N) vs tabla puente N:M

`profiles.legal_guardian_id uuid FK legal_guardians ON DELETE SET NULL`, nullable. Un menor tiene como mucho un representante activo; un representante puede tener varios menores (1:N). Se evita tabla puente N:M que complicaría UX y validación (un menor con dos tutores activos no es requisito). Un N:M futuro se añadiría sin romper este modelo (migrar a tabla intermedia si producto lo exige).

### D2 — `is_member + member_user_id` coherentes por CHECK (una tabla)

`legal_guardians (is_member boolean default false, member_user_id uuid FK profiles SET NULL, CHECK chk_guardian_member_has_user: (not is_member and member_user_id is null) or (is_member and member_user_id is not null))`. Unifica interno/externo sin duplicar entidades. El CHECK es la fuente de verdad DB; Zod hace `superRefine` coherente y el guard valida existencia del miembro (activo, no menor, no borrado).

### D3 — Reutiliza `umsuka.is_management()` sin crear `is_directiva`

No se crea helper duplicado. `is_management()` (0013, `SECURITY DEFINER`, `stable`, grant a `authenticated`) ya cubre exactamente `MANAGEMENT_ROLES`. Ver ADR-24 D4 y ADR-29 D2.

### D4 — `is_minor default false + guardian nullable` (flujo progresivo)

`profiles.is_minor boolean not null default false`, `legal_guardian_id` nullable. La obligatoriedad de representante para menores se aplica en app-layer (mutations/actions) no con `CHECK` DB, permitiendo flujo progresivo: alta como menor sin representante y asignación posterior por directiva. Si `is_minor=false`, se limpia `legal_guardian_id` automáticamente.

### D5 — RLS directiva exclusiva en `legal_guardians` (invisibilidad real)

```sql
alter table umsuka.legal_guardians enable row level security;
alter table umsuka.legal_guardians force row level security;
create policy "legal_guardians_select_management" on umsuka.legal_guardians for select to authenticated using (umsuka.is_management());
create policy "legal_guardians_write_management" on umsuka.legal_guardians for all to authenticated using (umsuka.is_management()) with check (umsuka.is_management());
```

SELECT y FOR ALL solo para directiva → resto ve 0 filas (como `transactions` en 0062). Sin políticas para `anon` → fallback deny.

### D6 — RLS `profiles` intacta (ADR-14), visión del representante vía app-layer

`profiles` no gana política nueva. El representante ve a sus menores vía `getMinorsByGuardian(member_user_id = auth.uid())` (dos queries app-layer: `legal_guardians where member_user_id` → `profiles where legal_guardian_id in (...)`) evitando recursión RLS. Plantilla `profiles_select_guardian_minor` queda comentada en la migración para futuro `SECURITY DEFINER` si se quiere exponer vía RLS.

### D7 — Zod isomórfico con `optionalTrimmedText->null`, `isValidEmail/Phone`, refine coherencia

`src/lib/guardians/schema.ts`:

- `optionalTrimmedText(max, msg)` = `z.string().trim().max(...).transform(""->null).nullable().optional()` (patrón instruments).
- `emailField` / `phoneField` con `""->null` + `refine(isValidEmail/Phone)` y mensajes es-ES.
- `createGuardianSchema`: `full_name` 1-200 requerido, `document_id/email/phone/relationship` opcionales, `is_member boolean`, `member_user_id nullable uuid` + `superRefine` coherencia (misma lógica que CHECK). `isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/`, `isValidPhone = /^[\d\s+\-()]{7,50}$/`.
- `updateGuardianSchema` = base fields + `id uuid` + mismo `superRefine` (no `.extend` sobre `ZodEffects`).
- `assignGuardianSchema {minor_id uuid, guardian_id uuid}`, `unassignGuardianSchema {minor_id uuid}`, `setMinorStatusSchema {user_id uuid, is_minor boolean, legal_guardian_id nullable uuid}`.

### D8 — hand-edited `src/types/database.types.ts` + checklist manual

Añadidos `Tables.legal_guardians` (Row/Insert/Update + Relationships `member_user_id/created_by -> profiles`) y `profiles.is_minor` + `legal_guardian_id` + Relationship `profiles_legal_guardian_id_fkey`. `Functions.is_management` ya existía. `tsc --noEmit` y checklist en migración reemplazan `supabase gen-types`.

### D9 — Queries en `src/lib/guardians/queries.ts` (sin `SECURITY DEFINER`)

- `getGuardians()` / `getGuardianById(id)`: lecturas directas ordenadas por `created_at desc`, mapeo `snake->camel`.
- `getMinorsByGuardian(memberUserId)`: dos pasos (guardian ids → perfiles `is_minor=true`).
- `getMinorWithGuardian(minorId)`: perfil + left join guardian.
- `getMinorsWithGuardians()`: todos los menores + batch de guardians `in (ids)`.
- `getAvailableMembersForGuardian()`: `is_minor=false AND deleted_at null AND status=active AND is_active=true` ordenados por `first_name`.
- Errores con `throw new Error("Error al obtener ...: ${error.message}")`.

### D10 — Una migración (0063) + tipos, sin Supabase CLI

Sin CLI local, migración idempotente (`if not exists`, `add column if not exists`, `drop policy/trigger if exists`, `create index if not exists`) + checklist de 13 comprobaciones. Fila 0063 añadida en `docs/DATABASE.md`.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| **Tabla puente N:M `guardian_minors`** | Sobrediseño para 1:N actual (un menor, un representante). Añade complejidad de UX y de validación; migrar a N:M luego es no breaking. |
| **Dos tablas `internal_guardians` / `external_guardians`** | Duplicaría esquema y queries; CHECK + `is_member` unifica sin costo. |
| **Nueva función `umsuka.is_directiva()`** | Duplicaría `is_management()` (0013) con riesgo de divergencia (ADR-24). |
| **RLS `profiles` con política `guardian ve sus menores`** | Introduce recursión RLS (`profiles` ↔ `legal_guardians`) y surface `SECURITY DEFINER` innecesaria; app-layer es suficiente y ya probada (stats). |
| **`CHECK is_minor -> legal_guardian_id not null`** | Bloquearía flujo progresivo (alta menor sin representante inmediato). Validación app-layer + UI guide es más flexible. |
| **Agregación SQL `SECURITY DEFINER` para `getMinorsByGuardian`** | Prematuro; dos queries simples en JS son legibles y testeables para <10k filas. |

---

## Edge cases manejados

| Escenario | Comportamiento |
|---|---|
| No autenticado | `getCurrentProfile` → null → redirect `/auth/login` (page guard); mutations throw `Se requiere autenticación.` |
| `member` accede a `/guardians` | Redirect `/dashboard`; aunque se saltara, RLS devuelve 0 filas y `showFor` oculta navegación. |
| `member` llama mutations | Rechazo temprano `Solo la directiva puede gestionar representantes.` sin tocar DB. |
| `full_name` vacío o >200 | Zod reject (`min 1`, `max 200`), CHECK DB como defensa. |
| `email` inválido o >320 | Zod `isValidEmail` + `max 320`. |
| `phone` inválido o >50 | Zod `isValidPhone` + `max 50` (permite `+ - ( )` y espacios). |
| `is_member=true` sin `member_user_id` / viceversa | Zod `superRefine` + CHECK DB `chk_guardian_member_has_user`. |
| `member_user_id` es menor o inactivo | Mutations rechazan `El miembro seleccionado ya no está disponible.` / `Un menor no puede ser representante.` |
| `minor_id` no es menor | `assignGuardian` rechaza `El perfil no está marcado como menor.` |
| `guardian_id` inexistente | Rechaza `Representante no encontrado.` |
| `unassign` sin guardián | `update legal_guardian_id = null` idempotente (siempre success si perfil existe). |
| `setMinorStatus is_minor=false` con guardian | Limpia `legal_guardian_id` a `null` siempre. |
| `legal_guardians` borrado | FK `SET NULL` deja `profiles.legal_guardian_id = null`; menor queda sin representante (debe reasignarse). |
| Re-ejecución migración | Idempotente (`IF NOT EXISTS`, `DROP ... IF EXISTS`). |
| `anon` | Sin políticas → fallback deny. |

---

## Consecuencias

### Positivas

- **Flujo menor + representante** cerrado: alta, asignación, edición, desasignación y visión del representante.
- **Invisibilidad real** para no directiva (RLS) + `showFor` en navegación — tres capas coherentes.
- **Modelo unificado** interno/externo sin duplicación + CHECK como invariante DB.
- **Cero helpers duplicados**: reutiliza `is_management()`.
- **Suite nueva verde**: 63 tests nuevos (36 schema + 27 mutations) sobre **1339 tests en 89 archivos** (fue 1276/87).
- **`tsc`/`eslint`/`next build` limpios** (`/guardians` 2.8 kB, `/guardians/mis-menores` 228 B).

### Seguridad (defensa en profundidad)

- **Sin surface `SECURITY DEFINER` nueva**.
- **RLS `ENABLE + FORCE`** en `legal_guardians`; checklist verifica `pg_policies` (2 políticas `to authenticated` con `is_management()`).
- **Fail-closed** en guards y queries.

### Trade-offs / hallazgos conocidos

1. **Sin paginación** en `getGuardians` / `getMinorsWithGuardians`: asumible para <500 filas; añadir `limit` si crece.
2. **Obligatoriedad de representante no enforced en DB**: menor sin guardián es válido en DB; UI y mutations guían pero no bloquean hard.
3. **Hard `is_member` toggle**: cambiar de externo a miembro requiere `member_user_id`; no hay migración automática de datos de contacto.
4. **N:M futuro**: si un menor necesita 2 tutores, migrar a tabla puente.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101006300_legal_guardians.sql` | CREATE — tabla `legal_guardians` con CHECKs/índices/trigger/comments + columnas `profiles.is_minor`/`legal_guardian_id` + índices parciales/compuestos + RLS directiva exclusiva + checklist + plantilla comentada |
| `src/types/database.types.ts` | MODIFY — hand-edited: `Tables.legal_guardians` + `profiles.is_minor`/`legal_guardian_id` + Relationships |
| `src/lib/guardians/schema.ts` | CREATE — Zod schemas `create/update/assign/unassign/setMinorStatus` + helpers `isValidEmail/Phone`, `optionalTrimmedText`, `superRefine` coherencia |
| `src/lib/guardians/queries.ts` | CREATE — `getGuardians`, `getGuardianById`, `getMinorsByGuardian`, `getMinorWithGuardian`, `getAvailableMembersForGuardian`, `getMinorsWithGuardians` |
| `src/lib/guardians/mutations.ts` | CREATE — `createGuardian`, `updateGuardian`, `assignGuardian`, `unassignGuardian`, `setMinorStatus` con `requireManagementGuard` |
| `src/lib/guardians/actions.ts` | CREATE — 5 server actions thin con `revalidatePath("/guardians","/admin/users","/members","/profile")` |
| `src/app/guardians/page.tsx` | CREATE — página gestión directiva: guard + `Promise.all` queries + `GuardianForm` + `MinorGuardianList` + `Assign/Unassign/SetMinorStatus` |
| `src/app/guardians/guardian-form.tsx` | CREATE — form create/edit con radio `is_member`, select miembros disponibles |
| `src/app/guardians/assign-guardian-form.tsx` | CREATE — forms asignar/quitar representación y marcar `is_minor` |
| `src/app/guardians/minor-guardian-list.tsx` | CREATE — listado de menores con badge de representante |
| `src/app/guardians/mis-menores/page.tsx` | CREATE — vista representante: `getMinorsByGuardian(currentUser.id)` |
| `src/components/layout/nav-links.ts` | MODIFY — entrada `Representantes` (`/guardians`, `Shield`, `showFor: isManagementRole`) |
| `src/app/profile/page.tsx` | MODIFY — tarjeta representante si `is_minor` y sección `Menores a cargo` |
| `src/app/members/[id]/page.tsx` | MODIFY — bloque representante / menores a cargo |
| `tests/unit/lib/guardians-schema.test.ts` | CREATE — 36 tests Zod (full_name, email/phone, longitudes, coherencia `is_member`, uuid, setMinor) |
| `tests/unit/lib/guardians-mutations.test.ts` | CREATE — 27 tests chain-builder mocks (guards antes de DB, Zod, `created_by`, not-found, validaciones de miembro/menor) |
| `tests/unit/components/bottom-nav.test.tsx` | MODIFY — super_admin 17 → 18 (Representantes) |
| `tests/unit/lib/finances-mutations.test.ts` | MODIFY — `!` non-null para `tsc` |
| `docs/DATABASE.md` | MODIFY — fila 0063 |
| `tasks/sprint-30-legal-guardian.json` | CREATE — tarea del sprint |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/lib/guardians-schema.test.ts` (CREATE) | 36 — `create` (externo/miembro válidos, `""->null`, vacíos, longitudes, email/phone inválidos, coherencia `is_member`, trim), `update` uuid + coherencia, `assign/unassign` uuids, `setMinorStatus` (true/false con/ sin guardian, `""->null`, uuid) |
| `tests/unit/lib/guardians-mutations.test.ts` (CREATE) | 27 — `create` rechaza `member`, crea externo con `created_by`, valida miembro disponible/no-menor, `""->null`, Zod, error crudo; `update` rechaza `member`, not-found, actualiza, valida uuid; `assign` rechaza `member`, not-found minor/no-minor/guardian, asigna, valida uuid; `unassign` rechaza `member`, not-found, desasigna, valida uuid; `setMinorStatus` rechaza `member`, not-found, set true sin guardian, false limpia, valida guardian inexistente, valida uuid |

**Verificado en local (2026-08-26):** `npx vitest run` → **1339 tests en 89 archivos, todos pasando** (63 nuevos, 1 ajustado en `bottom-nav`); `npx tsc --noEmit` limpio; `npx eslint . --max-warnings=0` limpio; `npx next build` sin errores (`/guardians` 2.8 kB). Security scan: CLEAR, 0 HIGH.

---

## Referencias

- Task file: `tasks/sprint-30-legal-guardian.json`
- ADR-029 (Money Management): patrón para RLS `is_management()`, Zod isomórfico y checklist sin CLI
- ADR-024 §D4: reutilizar `is_management()` vs crear `is_directiva`
- Sprint 2 (`roles.ts` `MANAGEMENT_ROLES`) y migración 0013 (`is_management`)
- `src/app/instruments/*` y `src/lib/finances/*`: patrones seguidos
- `docs/DATABASE.md`: fila 0063
- `docs/git-conventions.md`: rama `feature/sprint-30-legal-guardian`, commits `feat(sprint-30)`/`test(sprint-30)`/`docs(sprint-30)`
