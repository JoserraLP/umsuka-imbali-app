-- =========================================================
-- UMSUKA IMBALI APP — 0070: fix user_preferences table missing in schema cache (Sprint 25 patch)
-- =========================================================
-- Corrige: getListOrdering: Could not find the table 'umsuka.user_preferences' in the schema cache
-- Causa probable: 0059 falló por ERROR 42703 column "entry" does not exist en is_valid_list_ordering
--   (fixed en 0061 solo la función, pero si 0059 se marcó como aplicado parcialmente,
--   la tabla puede no existir en remoto o el PostgREST cache quedó stale).
-- Esta migración es idempotente y re-crea todo lo de 0059 + trigger + RLS
-- y fuerza reload del schema cache.
--

-- 1. Tabla (idempotente)
create table if not exists umsuka.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  list_ordering jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table umsuka.user_preferences is
  'Per-user app preferences. Stores persisted sort per listing (members/instruments/events) in list_ordering.';

comment on column umsuka.user_preferences.list_ordering is
  'JSON { <listId>: { "sortBy": string, "direction": "asc"|"desc" } }. Forward-compatible via Zod strip.';

-- 2. Función validadora (ya parcheada en 0061, re-aplicar por si acaso)
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
          true
        )
    from jsonb_each(value) as t(k, v)
$$;

comment on function umsuka.is_valid_list_ordering(value jsonb) is
  'True when value is object whose entries are {sortBy: non-empty string, direction: asc|desc}. Accepts {}.';

-- 3. CHECK (drop + add idempotente)
do $$ begin
  if exists (select 1 from pg_constraint where conname = 'chk_user_preferences_list_ordering_shape' and conrelid = 'umsuka.user_preferences'::regclass) then
    alter table umsuka.user_preferences drop constraint chk_user_preferences_list_ordering_shape;
  end if;
end$$;

alter table umsuka.user_preferences
  add constraint chk_user_preferences_list_ordering_shape
  check (umsuka.is_valid_list_ordering(list_ordering));

-- 4. Trigger updated_at (reusa helper de 0018)
drop trigger if exists trg_user_preferences_updated_at on umsuka.user_preferences;

create trigger trg_user_preferences_updated_at
  before update on umsuka.user_preferences
  for each row
  execute function umsuka.update_updated_at_column();

-- 5. RLS (idempotente: drop + create)
alter table umsuka.user_preferences enable row level security;
alter table umsuka.user_preferences force row level security;

drop policy if exists user_preferences_select_own on umsuka.user_preferences;
create policy user_preferences_select_own
  on umsuka.user_preferences for select
  to authenticated
  using (user_id = auth.uid());

drop policy if exists user_preferences_insert_own on umsuka.user_preferences;
create policy user_preferences_insert_own
  on umsuka.user_preferences for insert
  to authenticated
  with check (user_id = auth.uid());

drop policy if exists user_preferences_update_own on umsuka.user_preferences;
create policy user_preferences_update_own
  on umsuka.user_preferences for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists user_preferences_delete_own on umsuka.user_preferences;
create policy user_preferences_delete_own
  on umsuka.user_preferences for delete
  to authenticated
  using (user_id = auth.uid());

-- 6. Grants (por si faltaban)
grant select, insert, update, delete on table umsuka.user_preferences to authenticated;

-- 7. Fuerza reload del PostgREST schema cache (evita "Could not find table in schema cache" tras DDL)
select pg_notify('pgrst', 'reload schema');
select pg_notify('pgrst', 'reload config');

-- MANUAL CHECKLIST
-- [ ] \d umsuka.user_preferences muestra user_id PK, list_ordering jsonb default '{}', created_at, updated_at
-- [ ] SELECT umsuka.is_valid_list_ordering('{}') -> true
-- [ ] INSERT INTO umsuka.user_preferences(user_id, list_ordering) VALUES (auth.uid(), '{}') OK
-- [ ] RLS: SELECT como authenticated solo ve su fila, otro user_id -> 0 rows
-- [ ] Supabase PostgREST: GET /rest/v1/user_preferences?select=* (con JWT) no da 404 schema cache
-- [ ] getListOrdering(userId) ya no loggea "Could not find table" sino que retorna {} si tabla aún no existe (fail-open)
