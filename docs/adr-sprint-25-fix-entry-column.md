# Fix Sprint 25: ERROR 42703 column «entry» does not exist en umsuka.is_valid_list_ordering

**Status:** Accepted (Implementado) · **Date:** 2026-08-24 · **Tipo:** Fix de migración · **Sprint:** 25 ·
**Branch:** `fix/sprint-25-user-preferences-entry`

---

## Context

La migración `20260101005900_user_preferences.sql` (Sprint 25, ADR-025) creaba la función
SQL `umsuka.is_valid_list_ordering(jsonb)` que respalda el CHECK de sobreestructura
`chk_user_preferences_list_ordering_shape` de `umsuka.user_preferences`. La función iteraba
las entradas del documento con `FROM jsonb_each(value)` **sin alias** y referenciaba una
columna `entry` que no existe: `jsonb_each` devuelve exactamente `(key text, value jsonb)`,
y al faltar el alias PostgreSQL resuelve los nombres contra esas columnas reales. Como el
cuerpo de una función `language sql` se valida en ejecución, el fallo no saltaba al crear
la función sino al invocarla, abortando con:

```
ERROR 42703: column "entry" does not exist
```

## Decision

1. **Corrección in situ de la 05900**: alias explícito `jsonb_each(value) AS t(k, v)` y
   validación sobre `v` (`jsonb_typeof(v) = 'object'`, `v ? 'sortBy'`, texto no vacío,
   `direction in ('asc','desc')`). La migración queda correcta para despliegues limpios.
2. **Migración de parche `20260101006100_fix_user_preferences_entry.sql`** con
   `CREATE OR REPLACE FUNCTION` idéntica a la ya corregida: repara bases de datos donde la
   05900 ya se había aplicado dejando la función rota. El CHECK **no necesita recrearse**:
   referencia la función por nombre, así que basta con reemplazar su cuerpo.
3. Atributos preservados: `language sql`, `IMMUTABLE` (el resultado solo depende del
   argumento, con `search_path` fijado a `umsuka, public`) y re-aplicación del
   `comment on function` documentando el parche.
4. `'{}'` sigue siendo válido vía `coalesce(bool_and(...), true)`: documento sin entradas
   significa «usar defaults de la app».

## Consequences

### Positivas

- La 05900 aplica limpia y el CHECK rechaza documentos inválidos (23514) como estaba
  diseñado; el listado nunca ve un `list_ordering` malformado desde la BD.
- Parche **idempotente** (`create or replace`): re-ejecutable sin efectos secundarios y
  aplicable sobre cualquier estado previo (función rota o ya corregida).
- Fix puramente SQL: sin cambios de esquema, tipos TS ni capa de aplicación (delta cero).

### Observaciones

- Lección registrada para el patrón «CHECK vía función IMMUTABLE»: sin entorno Supabase
  local, el checklist manual pre-deploy es la única barrera contra errores de ejecución;
  debe ejecutarse siempre (aquí habría detectado el 42703 antes del deploy).
- Numeración con hueco (0059 → 0061): deliberada, no renumerar migraciones ya aplicadas.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101005900_user_preferences.sql` | MODIFY — alias `t(k, v)` y validación sobre `v` en `is_valid_list_ordering` (corregida in situ) |
| `supabase/migrations/20260101006100_fix_user_preferences_entry.sql` | CREATE — parche `CREATE OR REPLACE FUNCTION` + comment actualizado + checklist manual pre-deploy |

---

## Validación

**Verificado en local (2026-08-24):** `npx tsc --noEmit` limpio; `npx vitest run` →
**1240 tests en 85 archivos, todos pasando**; `npx eslint . --max-warnings=0` limpio.
Checklist SQL del parche: `'{}'` → true, entrada válida → true, dirección inválida o
entrada no-objeto → false, INSERT inválido → 23514, sin rastro del 42703.

---

## Referencias

- ADR-025 (Sprint 25 — Ordenación de Listados): diseño original de `user_preferences` y
  del CHECK vía función IMMUTABLE (D1) que este fix repara.
- Commit: `09e93c9` `fix(sprint-25): alias jsonb_each columns in list ordering validator`;
  convenciones de rama/commits en `docs/git-conventions.md`.
