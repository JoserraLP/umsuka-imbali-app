-- =========================================================
-- UMSUKA IMBALI APP — 0046: event waitlist
-- =========================================================
-- Waiting list for full events (or events past their registration
-- deadline). Members join in FIFO order (position), and when a spot
-- frees up the first waiting entry is promoted to a real registration.
--
-- Position handling is fully DB-driven so it stays correct under
-- concurrency:
--   * assign_waitlist_position() computes max(position)+1 while holding
--     the parent event row lock (SELECT ... FOR UPDATE), serializing
--     concurrent joins for the same event.
--   * renumber_waitlist_after_delete() shifts every later position down
--     by one after a removal, keeping positions gapless.

do $$ begin
  create type umsuka.waitlist_status as enum (
    'waiting', 'promoted', 'declined', 'removed'
  );
exception
  when duplicate_object then null;
end $$;

comment on type umsuka.waitlist_status is
  'Waitlist entry lifecycle: waiting, promoted (became a registration), declined (offered and refused), removed (admin removed).';

create table umsuka.event_waitlist (
    id uuid default gen_random_uuid() primary key,
    event_id uuid not null references umsuka.events(id)
        on delete cascade,
    user_id uuid not null references auth.users(id)
        on delete cascade,
    position integer not null check (position > 0),
    status umsuka.waitlist_status not null default 'waiting',
    joined_at timestamptz not null default now(),
    promoted_at timestamptz,
    unique (event_id, user_id)
);

comment on table umsuka.event_waitlist is
  'Members waiting for a free spot in a full or closed event. One entry per member per event.';

create index idx_event_waitlist_event_position on umsuka.event_waitlist (event_id, position);
create index idx_event_waitlist_event_user on umsuka.event_waitlist (event_id, user_id);

-- ---------------------------------------------------------
-- Position triggers
-- ---------------------------------------------------------
create or replace function umsuka.assign_waitlist_position()
returns trigger
language plpgsql
security definer
set search_path = umsuka, public
as $$
declare
  v_max integer;
begin
  -- Lock the parent event row so concurrent joins for the same event
  -- are serialized: the max(position)+1 below is then race-safe.
  perform 1 from umsuka.events where id = new.event_id for update;

  select coalesce(max(position), 0) + 1 into v_max
  from umsuka.event_waitlist
  where event_id = new.event_id;

  new.position := v_max;
  return new;
end;
$$;

comment on function umsuka.assign_waitlist_position() is
  'BEFORE INSERT trigger: assigns the next FIFO position, locking the parent event row to stay race-safe.';

drop trigger if exists trg_assign_waitlist_position on umsuka.event_waitlist;

create trigger trg_assign_waitlist_position
  before insert on umsuka.event_waitlist
  for each row
  execute function umsuka.assign_waitlist_position();

create or replace function umsuka.renumber_waitlist_after_delete()
returns trigger
language plpgsql
security definer
set search_path = umsuka, public
as $$
begin
  update umsuka.event_waitlist
  set position = position - 1
  where event_id = old.event_id
    and position > old.position;
  return null;
end;
$$;

comment on function umsuka.renumber_waitlist_after_delete() is
  'AFTER DELETE trigger: shifts every later position down by one, keeping the waitlist gapless.';

drop trigger if exists trg_renumber_waitlist_after_delete on umsuka.event_waitlist;

create trigger trg_renumber_waitlist_after_delete
  after delete on umsuka.event_waitlist
  for each row
  execute function umsuka.renumber_waitlist_after_delete();

-- ---------------------------------------------------------
-- RLS
-- ---------------------------------------------------------
alter table umsuka.event_waitlist enable row level security;
alter table umsuka.event_waitlist force row level security;

-- Members see only their own waitlist position (no public counts);
-- management sees the whole list to manage promotions.
create policy "event_waitlist_select_own_or_management"
  on umsuka.event_waitlist for select
  to authenticated
  using (
    umsuka.is_active_member()
    and (user_id = auth.uid() or umsuka.is_management())
  );

create policy "event_waitlist_insert_own"
  on umsuka.event_waitlist for insert
  to authenticated
  with check (user_id = auth.uid());

-- Status changes (promote/decline/remove) are management-only.
create policy "event_waitlist_update_management"
  on umsuka.event_waitlist for update
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

create policy "event_waitlist_delete_own_or_management"
  on umsuka.event_waitlist for delete
  to authenticated
  using (user_id = auth.uid() or umsuka.is_management());

-- ---------------------------------------------------------
-- service_role grants (admin client)
-- ---------------------------------------------------------
-- The admin client (service_role key) is used by server-side code and
-- bypasses RLS, but service_role is NOT a superuser in standard Supabase
-- setups, so it needs explicit table-level grants (same pattern as
-- migrations 0030/0033).
--
-- promoteNextFromWaitlist() promotes the first waiting member after an
-- unregistration via the admin client:
--   * SELECT + UPDATE on umsuka.event_waitlist (read waiting entries,
--     mark them promoted),
--   * SELECT + INSERT on umsuka.event_registrations (count registrations,
--     insert the new one).
-- It never DELETEs through the admin client (removals go through RLS as
-- the acting member/management).
grant select, insert, update on table umsuka.event_waitlist to service_role;
grant select, insert on table umsuka.event_registrations to service_role;