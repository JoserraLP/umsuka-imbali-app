-- =========================================================
-- UMSUKA IMBALI APP — 0061: fix is_valid_list_ordering alias (Sprint 25 patch)
-- =========================================================
-- Corrige ERROR 42703 column "entry" does not exist en
-- umsuka.is_valid_list_ordering (introducido en 0059).
--
-- Causa: 0059 hacía FROM jsonb_each(value) y referenciaba "entry",
--         columna que no existe — jsonb_each devuelve (key text, value jsonb).
--         Al no haber alias, PostgreSQL busca una columna "entry" y falla.
--
-- Fix: alias explícito AS t(k, v) y validar sobre v. CREATE OR REPLACE
--      hace el parche idempotente y repara BBDD donde 0059 ya se intentó
--      aplicar (o donde quedó la función rota).
--
-- Re-aplica el comment y deja intacto el CHECK constraint (ya apunta a la
-- función por nombre, no necesita recrearse).

create or replace function umsuka.is_valid_list_ordering(value jsonb)
returns boolean
language sql
immutable
set search_path = umsuka, public
as $$
  select jsonb_typeof(value) = 'object'
    and coalesce(
          bool_and(
            jsonb_typeof(v) = 'object'
            and v ? 'sortBy'
            and jsonb_typeof(v -> 'sortBy') = 'string'
            and length(v ->> 'sortBy') > 0
            and v ->> 'direction' in ('asc', 'desc')
          ),
          true  -- '{}' has no entries: valid
        )
    from jsonb_each(value) as t(k, v)
$$;

comment on function umsuka.is_valid_list_ordering(value jsonb) is
  'True when value is a jsonb object whose every entry is an object with a non-empty text sortBy and a direction of asc|desc. Used by the user_preferences shape CHECK; accepts ''{}''. Patched in 0061: fixed jsonb_each alias (entry -> v).';

-- ---------------------------------------------------------
-- MANUAL CHECKLIST
-- [ ] SELECT umsuka.is_valid_list_ordering('{}') -> true
-- [ ] SELECT umsuka.is_valid_list_ordering('{"members":{"sortBy":"name","direction":"asc"}}') -> true
-- [ ] SELECT umsuka.is_valid_list_ordering('{"members":{"sortBy":"name","direction":"sideways"}}') -> false
-- [ ] SELECT umsuka.is_valid_list_ordering('{"members":"x"}') -> false (entry not an object)
-- [ ] INSERT INTO umsuka.user_preferences(user_id, list_ordering) VALUES (auth.uid(), '{"invalid":1}') falla con 23514 (CHECK)
-- [ ] No más ERROR 42703 column "entry" does not exist
-- ---------------------------------------------------------
