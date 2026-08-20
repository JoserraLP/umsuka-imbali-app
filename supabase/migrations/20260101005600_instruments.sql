-- =========================================================
-- UMSUKA IMBALI APP — 0056: instrument management (Sprint 24)
-- =========================================================
-- Inventory of the comparsa's instruments: create, soft-deactivate
-- (is_active) and edit instruments; assign one responsible person per
-- instrument at a time (an instrument can never have two active
-- responsables) while keeping a full assignment history.
--
-- Design decisions:
--   1. "One responsable at a time" is enforced by a PARTIAL UNIQUE
--      index on (instrument_id) WHERE unassigned_at IS NULL; the two-
--      step close-then-insert flow in the app layer (src/lib/instruments/
--      mutations.ts) keeps the UI transactional-enough and the unique
--      index is the final defense against concurrent assigns.
--   2. RLS follows the 0013 baseline pattern: everything is readable by
--      any authenticated member (association transparency model);
--      writes are restricted to management roles via the existing
--      umsuka.is_management() helper (super_admin, admin, board_member,
--      event_manager — created in 0013, no new helper needed).
--   3. instrument_assignments has NO delete policy: history rows are
--      immutable by design, assignments are only closed (unassigned_at).
--   4. umsuka.update_updated_at_column() already exists (0018), reused
--      verbatim by the instruments trigger.

-- ---------------------------------------------------------
-- 1. umsuka.instruments
-- ---------------------------------------------------------
create table umsuka.instruments (
    id uuid default gen_random_uuid() primary key,
    name text not null check (char_length(name) <= 200 and length(trim(name)) > 0),
    category text check (category is null or char_length(category) <= 100),
    description text check (description is null or char_length(description) <= 2000),
    is_active boolean not null default true,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
);

comment on table umsuka.instruments is
  'Inventory of the comparsa instruments. Deactivation is logical (is_active = false): inactive instruments are hidden from assignment listings and cannot be assigned.';

comment on column umsuka.instruments.name is
  'Instrument name, unique case-insensitively (idx_instruments_name_lower_unique).';
comment on column umsuka.instruments.is_active is
  'true = available in the inventory; false = soft-deactivated (inactive instruments cannot be assigned).';

-- Case-insensitive unique instrument name (mirrors the 0049 pattern
-- for voting options).
create unique index idx_instruments_name_lower_unique
    on umsuka.instruments (lower(name));

-- ---------------------------------------------------------
-- 2. umsuka.instrument_assignments
-- ---------------------------------------------------------
create table umsuka.instrument_assignments (
    id uuid default gen_random_uuid() primary key,
    instrument_id uuid not null references umsuka.instruments(id)
        on delete cascade,
    user_id uuid not null references umsuka.profiles(id)
        on delete cascade,
    assigned_at timestamptz not null default now(),
    unassigned_at timestamptz,
    constraint instrument_assignments_unassigned_not_before_assigned
        check (unassigned_at is null or unassigned_at >= assigned_at)
);

comment on table umsuka.instrument_assignments is
  'Responsible-person assignments per instrument. The ACTIVE assignment of an instrument is the row with unassigned_at IS NULL; closed rows form the historical record.';

comment on column umsuka.instrument_assignments.unassigned_at is
  'null while the assignment is active; set to the closing instant when the responsable is replaced or unassigned. Never deleted (history is immutable).';

-- At most ONE active assignment per instrument at any time.
create unique index idx_instrument_assignments_active_instrument
    on umsuka.instrument_assignments (instrument_id)
    where unassigned_at is null;

-- History reads per instrument (detail page) and per member.
create index idx_instrument_assignments_instrument_id
    on umsuka.instrument_assignments (instrument_id, assigned_at desc);
create index idx_instrument_assignments_user_id
    on umsuka.instrument_assignments (user_id);

-- ---------------------------------------------------------
-- 3. updated_at trigger on instruments
-- ---------------------------------------------------------
drop trigger if exists trg_instruments_updated_at on umsuka.instruments;

create trigger trg_instruments_updated_at
  before update on umsuka.instruments
  for each row
  execute function umsuka.update_updated_at_column();

-- ---------------------------------------------------------
-- 4. RLS
-- ---------------------------------------------------------
alter table umsuka.instruments enable row level security;
alter table umsuka.instruments force row level security;

create policy "instruments_select_authenticated"
  on umsuka.instruments for select
  to authenticated
  using (true);

create policy "instruments_write_management"
  on umsuka.instruments for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

alter table umsuka.instrument_assignments enable row level security;
alter table umsuka.instrument_assignments force row level security;

create policy "instrument_assignments_select_authenticated"
  on umsuka.instrument_assignments for select
  to authenticated
  using (true);

create policy "instrument_assignments_insert_management"
  on umsuka.instrument_assignments for insert
  to authenticated
  with check (umsuka.is_management());

create policy "instrument_assignments_update_management"
  on umsuka.instrument_assignments for update
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

-- No DELETE policy: assignment history must never be erased.

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (no Supabase local/CLI in this environment; SQL is
-- hand-reasoned — pattern of the previous sprints). Verify before deploy:
--
-- [ ] umsuka.instruments and umsuka.instrument_assignments exist with
--       the columns, checks and comments of sections 1-2.
-- [ ] idx_instruments_name_lower_unique rejects 'TAMBOR'/'tambor' (case-
--       insensitive uniqueness).
-- [ ] idx_instrument_assignments_active_instrument (partial unique) only
--       constrains rows with unassigned_at IS NULL: inserting a second
--       active row for the same instrument fails with 23505, while any
--       number of closed history rows is allowed.
-- [ ] trg_instruments_updated_at fires on UPDATE of umsuka.instruments
--       via umsuka.update_updated_at_column() (0018) and is idempotent
--       on re-run (drop trigger if exists).
-- [ ] RLS: authenticated members can SELECT both tables; INSERT/UPDATE
--       on instruments and INSERT/UPDATE on instrument_assignments are
--       rejected with 'new row violates row-level security policy' for
--       non-management roles; instrument_assignments has NO delete
--       policy (attempted deletes are always filtered out).
-- [ ] FK cascades: deleting an instrument removes its assignment rows;
--       deleting a profile removes their assignment rows (both tables
--       are FORCE RLS, so those deletes come from the service role or a
--       SECURITY DEFINER helper as in the rest of the schema).
-- [ ] supabase db push applies the migration; re-running it is safe.
-- ---------------------------------------------------------