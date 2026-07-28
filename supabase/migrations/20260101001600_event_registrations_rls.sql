-- =========================================================
-- UMSUKA IMBALI APP — 0017: registration capacity trigger + RLS
-- =========================================================

-- ---------------------------------------------------------
-- Capacity enforcement, atomic and race-safe.
--
-- The `select ... for update` locks the parent event row for the
-- duration of the inserting transaction, so two members registering for
-- the same event's last remaining spot at the same time are serialized
-- instead of both passing the count check and overbooking the event.
-- ---------------------------------------------------------
create or replace function umsuka.check_event_capacity()
returns trigger
language plpgsql
security definer
set search_path = umsuka, public
as $$
declare
  v_capacity integer;
  v_count integer;
begin
  select capacity into v_capacity
  from umsuka.events
  where id = new.event_id
  for update;

  if v_capacity is not null then
    select count(*) into v_count
    from umsuka.event_registrations
    where event_id = new.event_id;

    if v_count >= v_capacity then
      raise exception 'Event capacity reached for event %', new.event_id
        using errcode = 'P0001';
    end if;
  end if;

  return new;
end;
$$;

comment on function umsuka.check_event_capacity() is
  'Blocks a new registration once umsuka.events.capacity is reached. Locks the event row to stay race-safe under concurrent inserts.';

drop trigger if exists trg_check_event_capacity on umsuka.event_registrations;

create trigger trg_check_event_capacity
  before insert on umsuka.event_registrations
  for each row
  execute function umsuka.check_event_capacity();

-- ---------------------------------------------------------
-- RLS
-- ---------------------------------------------------------
alter table umsuka.event_registrations enable row level security;
alter table umsuka.event_registrations force row level security;

create policy "event_registrations_select_authenticated"
  on umsuka.event_registrations for select
  to authenticated
  using (true);

create policy "event_registrations_insert_own"
  on umsuka.event_registrations for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "event_registrations_delete_own_or_management"
  on umsuka.event_registrations for delete
  to authenticated
  using (user_id = auth.uid() or umsuka.is_management());

-- No update policy: a registration has no mutable fields — unregistering
-- is a delete, not an update.
