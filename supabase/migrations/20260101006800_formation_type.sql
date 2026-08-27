-- =========================================================
-- UMSUKA IMBALI APP — 0068: formation type separation (Sprint 33 fix)
-- =========================================================
-- Separa formaciones de baile vs música. Al crear se elige tipo
-- dance/music; solo responsables de cada tipo (component_type) + directiva
-- pueden ver/editar. Bailarinas juntas (sin pasillo) + filas dinámicas.
--
-- 1. ENUM formation_type
-- 2. Add column dance_formations.formation_type
-- 3. Helper current_user_component_type()
-- 4. RLS: SELECT restricted por tipo, WRITE sigue is_management()
-- 5. Grants + checklist
--

-- ---------------------------------------------------------
-- 1. ENUM umsuka.formation_type
-- ---------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_type where typname='formation_type' and typnamespace='umsuka'::regnamespace) then
    create type umsuka.formation_type as enum ('dance','music');
  end if;
end$$;

comment on type umsuka.formation_type is
  'Tipo de formación: dance = bailarinas (grid 6), music = músicos (instrumentos).';

-- ---------------------------------------------------------
-- 2. Add column to dance_formations
-- ---------------------------------------------------------
alter table umsuka.dance_formations
  add column if not exists formation_type umsuka.formation_type not null default 'dance'::umsuka.formation_type;

-- Ensure existing rows get 'dance' (default already does)
-- Remove default after backfill for strictness? keep default dance
comment on column umsuka.dance_formations.formation_type is
  'Tipo de formación: dance o music. Solo visible para miembros del componente correspondiente + directiva.';

create index if not exists idx_dance_formations_formation_type
  on umsuka.dance_formations (formation_type);

create index if not exists idx_dance_formations_type_created_at
  on umsuka.dance_formations (formation_type, created_at desc);

-- ---------------------------------------------------------
-- 3. Helper: current_user_component_type()
-- ---------------------------------------------------------
create or replace function umsuka.current_user_component_type()
returns text
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select component_type from umsuka.profiles where id = auth.uid();
$$;

comment on function umsuka.current_user_component_type() is
  'Returns component_type of current user (music/dance/member) or null if unauthenticated.';

grant execute on function umsuka.current_user_component_type() to authenticated;

-- ---------------------------------------------------------
-- 4. RLS: restrict SELECT by component type
-- ---------------------------------------------------------
-- Drop permissive policies if they exist (from 0067)
do $$ begin
  if exists (select 1 from pg_policies where policyname='dance_formations_select_authenticated' and tablename='dance_formations' and schemaname='umsuka') then
    drop policy dance_formations_select_authenticated on umsuka.dance_formations;
  end if;
end$$;

do $$ begin
  if exists (select 1 from pg_policies where policyname='dance_positions_select_authenticated' and tablename='dance_positions' and schemaname='umsuka') then
    drop policy dance_positions_select_authenticated on umsuka.dance_positions;
  end if;
end$$;

do $$ begin
  if exists (select 1 from pg_policies where policyname='musician_instruments_select_authenticated' and tablename='musician_instruments' and schemaname='umsuka') then
    drop policy musician_instruments_select_authenticated on umsuka.musician_instruments;
  end if;
end$$;

-- New SELECT policies: management sees all, otherwise only matching component
do $$ begin
  if not exists (select 1 from pg_policies where policyname='dance_formations_select_by_component' and tablename='dance_formations' and schemaname='umsuka') then
    create policy dance_formations_select_by_component
      on umsuka.dance_formations for select
      to authenticated
      using (
        umsuka.is_management()
        or formation_type::text = umsuka.current_user_component_type()
      );
  end if;
end$$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname='dance_positions_select_by_component' and tablename='dance_positions' and schemaname='umsuka') then
    create policy dance_positions_select_by_component
      on umsuka.dance_positions for select
      to authenticated
      using (
        umsuka.is_management()
        or exists (
          select 1 from umsuka.dance_formations df
          where df.id = formation_id
            and df.formation_type::text = umsuka.current_user_component_type()
        )
      );
  end if;
end$$;

do $$ begin
  if not exists (select 1 from pg_policies where policyname='musician_instruments_select_by_component' and tablename='musician_instruments' and schemaname='umsuka') then
    create policy musician_instruments_select_by_component
      on umsuka.musician_instruments for select
      to authenticated
      using (
        umsuka.is_management()
        or (
          formation_id is not null and exists (
            select 1 from umsuka.dance_formations df
            where df.id = formation_id
              and df.formation_type::text = umsuka.current_user_component_type()
          )
        )
        or (
          formation_id is null and umsuka.current_user_component_type() = 'music'
        )
      );
  end if;
end$$;

-- WRITE stays management (no change)
-- Ensure grants remain
grant select, insert, update, delete on table umsuka.dance_formations to authenticated;
grant select, insert, update, delete on table umsuka.dance_positions to authenticated;
grant select, insert, update, delete on table umsuka.musician_instruments to authenticated;

-- ---------------------------------------------------------
-- MANUAL CHECKLIST
-- ---------------------------------------------------------
-- [ ] \d umsuka.dance_formations shows formation_type formation_type NOT NULL default dance
-- [ ] SELECT pg_type typname='formation_type' with enums dance,music
-- [ ] current_user_component_type() returns correct for dance user vs music user
-- [ ] dance_forms: super_admin sees all types (2 rows dance+music)
-- [ ] dance user: SELECT from dance_formations returns only dance rows
-- [ ] music user: SELECT returns only music rows
-- [ ] member user: returns 0 rows
-- [ ] dance_positions for music formation not visible to dance user
-- [ ] INSERT as member => 42501
-- [ ] INSERT as management with formation_type => OK
-- [ ] Existing rows backfilled to dance
-- [ ] Re-run migration idempotent (DO duplicate_object)
