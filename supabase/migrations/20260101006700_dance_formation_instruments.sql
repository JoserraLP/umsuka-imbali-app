-- =========================================================
-- UMSUKA IMBALI APP — 0067: dance formation & musician instruments (Sprint 33)
-- =========================================================
-- Grid de bailarinas tipo asientos de avión (6 por fila, 3+pasillo+3)
-- y asignación de instrumentos a músicos por formación. La directiva
-- (is_management) gestiona; todos los miembros autenticados consultan.
--
-- Design decisions:
--   1. Corrección workgroup vs component_type (ADR-032): bailarinas
--      filtradas por profiles.component_type='dance', músicos por
--      'music', nunca por workgroup (telas/barra/estandarte/limpieza/
--      ninguno). Validación en Zod + mutations + queries espeja RLS.
--   2. Nueva tabla musician_instruments en lugar de extender
--      instrument_assignments: ésta mantiene semántica histórica
--      "un responsable por instrumento" con partial UNIQUE
--      (instrument_id) WHERE unassigned_at IS NULL; la nueva modela
--      "un instrumento por músico por formación" con
--      UNIQUE(user_id,formation_id) partial + UNIQUE(user_id) global
--      null; evita contaminar histórico y permite formation_id NULL =
--      asignación base. Alternativa descartada: reutilizar
--      instrument_assignments+formation_id acoplaría ciclos de vida
--      distintos y requeriría migración destructiva del índice parcial.
--   3. Grid 6 asientos fijos por fila (3+pasillo+3): seat_number 1-3
--      izquierda, 4-6 derecha; CHECK 1-6 y UNIQUE asiento; UI usa CSS
--      grid con gap central; drag&drop con @dnd-kit + fallback click.
--   4. RLS is_management() (super_admin/admin/board_member/event_manager)
--      para write, authenticated para read; guards fail-closed en
--      mutations/actions; sin SECURITY DEFINER nuevo; formation ligada
--      a evento opcional event_id SET NULL preserva formación base.
--   5. Idempotencia: UNIQUE asiento + UNIQUE miembro evitan duplicados
--      a nivel DB; mutations mapean 23505 a mensaje es-ES; moveDancer
--      como swap transaccional.
--   6. Export/print: window.print con @media print; sin nueva dep.

-- ---------------------------------------------------------
-- 1. umsuka.dance_formations
-- ---------------------------------------------------------
create table if not exists umsuka.dance_formations (
    id uuid primary key default gen_random_uuid(),
    name text not null check (char_length(name) between 1 and 200 and length(trim(name)) > 0),
    event_id uuid references umsuka.events(id) on delete set null,
    created_by uuid references umsuka.profiles(id) on delete set null,
    created_at timestamptz not null default now()
);

comment on table umsuka.dance_formations is
  'Formaciones de baile: plano de bailarinas (grid 6 por fila) e instrumentos de músicos. Ligada opcionalmente a evento (event_id SET NULL); NULL = formación base reutilizable.';
comment on column umsuka.dance_formations.name is
  'Nombre de la formación (1-200 caracteres, trim >0).';
comment on column umsuka.dance_formations.event_id is
  'Evento/desfile asociado. SET NULL al borrar evento para preservar formación base.';
comment on column umsuka.dance_formations.created_by is
  'Perfil que creó la formación. SET NULL si se borra.';
comment on column umsuka.dance_formations.created_at is
  'Instante de creación (default now()).';

create index if not exists idx_dance_formations_event_id
    on umsuka.dance_formations (event_id);
create index if not exists idx_dance_formations_created_by
    on umsuka.dance_formations (created_by);
create index if not exists idx_dance_formations_created_at
    on umsuka.dance_formations (created_at desc);

-- ---------------------------------------------------------
-- 2. umsuka.dance_positions
-- ---------------------------------------------------------
create table if not exists umsuka.dance_positions (
    id uuid primary key default gen_random_uuid(),
    formation_id uuid not null references umsuka.dance_formations(id) on delete cascade,
    row_number int not null check (row_number >= 1),
    seat_number int not null check (seat_number between 1 and 6),
    member_id uuid references umsuka.profiles(id) on delete set null,
    created_at timestamptz not null default now()
);

comment on table umsuka.dance_positions is
  'Posiciones de bailarinas en la formación: una fila por asiento (row_number >=1, seat_number 1-6). Grid 6 por fila tipo avión (3+pasillo+3). member_id NULL = asiento vacío.';
comment on column umsuka.dance_positions.formation_id is
  'Formación a la que pertenece el asiento. CASCADE al borrar formación.';
comment on column umsuka.dance_positions.row_number is
  'Número de fila (>=1). Sin límite superior.';
comment on column umsuka.dance_positions.seat_number is
  'Número de asiento en la fila (1-6): 1-3 izquierda, 4-6 derecha.';
comment on column umsuka.dance_positions.member_id is
  'Bailarina asignada (profiles.component_type=dance). NULL = asiento vacío. SET NULL si se borra el perfil (conserva plaza).';
comment on column umsuka.dance_positions.created_at is
  'Instante de creación del asiento.';

-- Una posición física no puede duplicarse
create unique index if not exists idx_dance_positions_unique_seat
    on umsuka.dance_positions (formation_id, row_number, seat_number);

-- Una bailarina no puede ocupar dos asientos en la misma formación (partial)
create unique index if not exists idx_dance_positions_unique_member
    on umsuka.dance_positions (formation_id, member_id)
    where member_id is not null;

create index if not exists idx_dance_positions_formation_id
    on umsuka.dance_positions (formation_id);
create index if not exists idx_dance_positions_member_id
    on umsuka.dance_positions (member_id);
create index if not exists idx_dance_positions_formation_row
    on umsuka.dance_positions (formation_id, row_number);

-- ---------------------------------------------------------
-- 3. umsuka.musician_instruments
-- ---------------------------------------------------------
create table if not exists umsuka.musician_instruments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid not null references umsuka.profiles(id) on delete cascade,
    instrument_id uuid not null references umsuka.instruments(id) on delete cascade,
    formation_id uuid references umsuka.dance_formations(id) on delete cascade,
    assigned_by uuid references umsuka.profiles(id) on delete set null,
    assigned_at timestamptz not null default now()
);

comment on table umsuka.musician_instruments is
  'Instrumento asignado a cada músico por formación (o base si formation_id NULL). Un músico solo puede tener un instrumento a la vez por formación; histórico por filas.';
comment on column umsuka.musician_instruments.user_id is
  'Músico (profiles.component_type=music). CASCADE al borrar perfil.';
comment on column umsuka.musician_instruments.instrument_id is
  'Instrumento del inventario (is_active=true requerido en app-layer). CASCADE al borrar instrumento.';
comment on column umsuka.musician_instruments.formation_id is
  'Formación asociada. NULL = asignación base reutilizable. CASCADE al borrar formación.';
comment on column umsuka.musician_instruments.assigned_by is
  'Perfil de directiva que asignó. SET NULL si se borra.';
comment on column umsuka.musician_instruments.assigned_at is
  'Instante de asignación (default now()).';

-- Un músico solo puede tener un instrumento por formación (partial)
create unique index if not exists idx_musician_instruments_user_formation
    on umsuka.musician_instruments (user_id, formation_id)
    where formation_id is not null;

-- Un músico solo puede tener un instrumento base global (formation_id IS NULL)
create unique index if not exists idx_musician_instruments_user_global
    on umsuka.musician_instruments (user_id)
    where formation_id is null;

-- Un instrumento no puede estar asignado a dos músicos en la misma formación
create unique index if not exists idx_musician_instruments_instrument_formation
    on umsuka.musician_instruments (instrument_id, formation_id)
    where formation_id is not null;

-- Instrumento base tampoco duplicado globalmente (opcional, evita doble base)
create unique index if not exists idx_musician_instruments_instrument_global
    on umsuka.musician_instruments (instrument_id)
    where formation_id is null;

create index if not exists idx_musician_instruments_user_id
    on umsuka.musician_instruments (user_id);
create index if not exists idx_musician_instruments_instrument_id
    on umsuka.musician_instruments (instrument_id);
create index if not exists idx_musician_instruments_formation_id
    on umsuka.musician_instruments (formation_id);
create index if not exists idx_musician_instruments_assigned_by
    on umsuka.musician_instruments (assigned_by);

-- ---------------------------------------------------------
-- 4. RLS — ENABLE + FORCE
-- ---------------------------------------------------------
alter table umsuka.dance_formations enable row level security;
alter table umsuka.dance_formations force row level security;
alter table umsuka.dance_positions enable row level security;
alter table umsuka.dance_positions force row level security;
alter table umsuka.musician_instruments enable row level security;
alter table umsuka.musician_instruments force row level security;

-- SELECT: cualquier authenticated puede consultar la formación (read transparency)
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'dance_formations_select_authenticated' and tablename = 'dance_formations' and schemaname = 'umsuka') then
    create policy dance_formations_select_authenticated
      on umsuka.dance_formations for select
      to authenticated
      using (true);
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'dance_positions_select_authenticated' and tablename = 'dance_positions' and schemaname = 'umsuka') then
    create policy dance_positions_select_authenticated
      on umsuka.dance_positions for select
      to authenticated
      using (true);
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'musician_instruments_select_authenticated' and tablename = 'musician_instruments' and schemaname = 'umsuka') then
    create policy musician_instruments_select_authenticated
      on umsuka.musician_instruments for select
      to authenticated
      using (true);
  end if;
end$$;

-- WRITE (all = insert/update/delete): solo management
do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'dance_formations_write_management' and tablename = 'dance_formations' and schemaname = 'umsuka') then
    create policy dance_formations_write_management
      on umsuka.dance_formations for all
      to authenticated
      using (umsuka.is_management())
      with check (umsuka.is_management());
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'dance_positions_write_management' and tablename = 'dance_positions' and schemaname = 'umsuka') then
    create policy dance_positions_write_management
      on umsuka.dance_positions for all
      to authenticated
      using (umsuka.is_management())
      with check (umsuka.is_management());
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_policies where policyname = 'musician_instruments_write_management' and tablename = 'musician_instruments' and schemaname = 'umsuka') then
    create policy musician_instruments_write_management
      on umsuka.musician_instruments for all
      to authenticated
      using (umsuka.is_management())
      with check (umsuka.is_management());
  end if;
end$$;

-- Grants for authenticated (RLS still enforced) + service_role bypass
grant select, insert, update, delete on table umsuka.dance_formations to authenticated;
grant select, insert, update, delete on table umsuka.dance_positions to authenticated;
grant select, insert, update, delete on table umsuka.musician_instruments to authenticated;
grant select, insert, update, delete on table umsuka.dance_formations to service_role;
grant select, insert, update, delete on table umsuka.dance_positions to service_role;
grant select, insert, update, delete on table umsuka.musician_instruments to service_role;

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (idempotente, sin CLI local)
-- Verificar antes de deploy:
--
-- [ ] \d umsuka.dance_formations muestra id PK, name text 1-200, event_id FK SET NULL, created_by FK SET NULL, created_at timestamptz
-- [ ] \d umsuka.dance_positions muestra formation_id FK CASCADE, row_number >=1, seat_number 1-6, member_id FK SET NULL
-- [ ] \d umsuka.musician_instruments muestra user_id FK CASCADE, instrument_id FK CASCADE, formation_id FK CASCADE NULL, assigned_by SET NULL
-- [ ] CHECK name 1-200: INSERT name '' => FAIL; name 201 chars => FAIL; name 'A' => OK
-- [ ] CHECK row_number >=1: INSERT row 0 => FAIL; row 1 => OK
-- [ ] CHECK seat 1-6: INSERT seat 0 => FAIL; seat 7 => FAIL; seat 3 => OK
-- [ ] UNIQUE asiento: INSERT mismo (formation,row,seat) => 23505 duplicate key
-- [ ] UNIQUE miembro: INSERT misma bailarina dos asientos misma formación => 23505 (idx_dance_positions_unique_member)
-- [ ] UNIQUE musician_instruments user+formation: INSERT mismo user+formation => 23505
-- [ ] UNIQUE musician_instruments global: INSERT mismo user con formation NULL dos veces => 23505
-- [ ] UNIQUE instrument+formation: INSERT mismo instrument+formation => 23505
-- [ ] Índices existen: pg_indexes LIKE idx_dance_% y idx_musician_%
-- [ ] RLS ENABLE+FORCE en las 3 tablas (pg_tables rowsecurity true, force true)
-- [ ] SELECT como authenticated sin management => OK (policy true)
-- [ ] INSERT como member (no management) => 42501 violates RLS (FOR ALL is_management)
-- [ ] INSERT como management (board_member etc.) => OK
-- [ ] Supabase service_role bypass => OK (grant + bypass RLS)
-- [ ] Re-run migration es idempotente (IF NOT EXISTS + DO duplicate_object guards); no error
-- [ ] Comentarios en pg_description para tablas/columnas
-- ---------------------------------------------------------
