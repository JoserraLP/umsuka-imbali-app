-- =========================================================
-- UMSUKA IMBALI APP — 0059: user preferences (list ordering)
-- =========================================================
-- Sprint 25: per-user list ordering preferences for /members,
-- /instruments and /events. One new table:
--
--   umsuka.user_preferences — one row per user (PK = user_id); the
--                             `list_ordering` jsonb document holds the
--                             saved sort per list.
--
-- Structure of this migration:
--   1. umsuka.user_preferences (PK FK auth.users ON DELETE CASCADE,
--      timestamps, SQL comments).
--   2. Shape CHECK via the IMMUTABLE helper umsuka.is_valid_list_ordering()
--      (PostgreSQL does not allow subqueries directly inside a CHECK, so
--      the validation lives in a function).
--   3. No extra indexes (the user_id PK covers every access pattern) and
--      no service_role grants (only the authenticated actor ever reads or
--      writes their own row through RLS).
--   4. updated_at trigger reusing umsuka.update_updated_at_column() from
--      migration 0018 (drop trigger if exists → idempotent re-runs).
--   5. RLS (enabled + forced) with 4 own-row policies mirroring 0052.
--
-- Document shape stored in list_ordering (validated by 2):
--   {
--     "members":     { "sortBy": "name",       "direction": "asc" },
--     "instruments": { "sortBy": "category",   "direction": "desc" },
--     "events":      { "sortBy": "event_date", "direction": "asc" }
--   }
-- Unknown keys are ignored by the app layer (Zod strip), so the document
-- is forward-compatible: new keys may be added later without migrating
-- old rows.

-- ---------------------------------------------------------
-- 1. umsuka.user_preferences
-- ---------------------------------------------------------
create table if not exists umsuka.user_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  list_ordering jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table umsuka.user_preferences is
  'Per-user app preferences. Currently stores only the persisted sort of each listing (members/instruments/events) in list_ordering; new preference groups should become new columns or jsonb keys, never new tables per preference.';

comment on column umsuka.user_preferences.list_ordering is
  'JSON document { <listId>: { "sortBy": string, "direction": "asc" | "desc" } }. Known listIds today: members, instruments, events. Unknown keys and fields are ignored by the app (forward-compatible); shape enforced by chk_user_preferences_list_ordering_shape.';

-- ---------------------------------------------------------
-- 2. Shape CHECK (IMMUTABLE SQL helper)
-- ---------------------------------------------------------
-- PostgreSQL rejects subqueries written directly inside a CHECK
-- constraint; wrapping the validation in an IMMUTABLE function is the
-- standard workaround. IMMUTABLE is honest here: the result depends only
-- on the argument (no table reads, fixed search_path).
create or replace function umsuka.is_valid_list_ordering(value jsonb)
returns boolean
language sql
immutable
set search_path = umsuka, public
as $$
  select jsonb_typeof(value) = 'object'
    and coalesce(
          bool_and(
            jsonb_typeof(entry) = 'object'
            and entry ? 'sortBy'
            and jsonb_typeof(entry -> 'sortBy') = 'string'
            and length(entry ->> 'sortBy') > 0
            and entry ->> 'direction' in ('asc', 'desc')
          ),
          true  -- '{}' has no entries: valid (means "use app defaults")
        )
    from jsonb_each(value)
$$;

comment on function umsuka.is_valid_list_ordering(value jsonb) is
  'True when value is a jsonb object whose every entry is an object with a non-empty text sortBy and a direction of asc|desc. Used by the user_preferences shape CHECK; accepts ''{}''.';

alter table umsuka.user_preferences
  add constraint chk_user_preferences_list_ordering_shape
  check (umsuka.is_valid_list_ordering(list_ordering));

-- ---------------------------------------------------------
-- 3. updated_at trigger (0018 helper reused verbatim)
-- ---------------------------------------------------------
drop trigger if exists trg_user_preferences_updated_at on umsuka.user_preferences;

create trigger trg_user_preferences_updated_at
  before update on umsuka.user_preferences
  for each row
  execute function umsuka.update_updated_at_column();

-- ---------------------------------------------------------
-- 4. RLS (own-row, mirrors 0052)
-- ---------------------------------------------------------
alter table umsuka.user_preferences enable row level security;
alter table umsuka.user_preferences force row level security;

create policy user_preferences_select_own
  on umsuka.user_preferences for select
  to authenticated
  using (user_id = auth.uid());

create policy user_preferences_insert_own
  on umsuka.user_preferences for insert
  to authenticated
  with check (user_id = auth.uid());

create policy user_preferences_update_own
  on umsuka.user_preferences for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy user_preferences_delete_own
  on umsuka.user_preferences for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (no Supabase local/CLI in this environment; SQL is
-- hand-reasoned — pattern of the previous sprints). Verify before deploy:
--
-- [ ] pg_policies shows exactly 4 new policies:
--       user_preferences_select_own, user_preferences_insert_own,
--       user_preferences_update_own, user_preferences_delete_own
--       (all `to authenticated`, all keyed on user_id = auth.uid()).
-- [ ] pg_class.relrowsecurity = true AND relforcerowsecurity = true for
--       umsuka.user_preferences (FORCE so even table owners go through
--       RLS).
-- [ ] An authenticated user can upsert their own row (insert then
--       update) and read/delete it; inserting/updating a row with
--       user_id = another user fails (with check / using policies).
-- [ ] Deleting an auth.users row cascades: the user_preferences row
--       disappears (FK on delete cascade).
-- [ ] trg_user_preferences_updated_at fires on UPDATE (updated_at >
--       created_at after a second save) via
--       umsuka.update_updated_at_column() (0018) and is idempotent on
--       re-run (drop trigger if exists).
-- [ ] chk_user_preferences_list_ordering_shape ACCEPTS '{}' and
--       '{"members":{"sortBy":"name","direction":"desc"}}'; REJECTS
--       '"texto"' (root not an object), '{"members":"x"}' (entry not an
--       object), '{"members":{"sortBy":"name"}}' (direction missing) and
--       '{"members":{"sortBy":"name","direction":"sideways"}}'
--       (invalid direction), each with check constraint violation 23514.
-- [ ] No extra indexes needed: every query filters by the user_id PK.
-- [ ] No service_role grants: the ordering module only ever touches the
--       caller's own row through the authenticated client.
-- [ ] supabase db push applies the migration; most statements are safe
--       to re-run (create table if not exists, drop/create trigger),
--       EXCEPT the plain "add constraint" for
--       chk_user_preferences_list_ordering_shape, which would fail with
--       "constraint already exists" on a second run (repo convention:
--       migrations run once via supabase db push).
-- ---------------------------------------------------------
