-- =========================================================
-- UMSUKA IMBALI APP — 0016: event capacity + registrations
-- =========================================================
-- BREAKING-CHANGE NOTE (non-breaking, additive):
-- Adds a nullable `capacity` column to umsuka.events (null = no limit).
-- Every existing row is unaffected.

alter table umsuka.events
  add column capacity integer;

alter table umsuka.events
  add constraint chk_events_capacity_positive check (capacity is null or capacity > 0);

comment on column umsuka.events.capacity is
  'Maximum number of registrations for this event. Null means unlimited.';

-- ---------------------------------------------------------
-- event_registrations (from the pre-approved extension list)
-- ---------------------------------------------------------
create table umsuka.event_registrations (
    id uuid default gen_random_uuid() primary key,
    event_id uuid not null references umsuka.events(id)
        on delete cascade,
    user_id uuid not null references auth.users(id)
        on delete cascade,
    created_at timestamptz default now(),
    unique (event_id, user_id)
);

comment on table umsuka.event_registrations is
  'A member''s registration ("apuntado") for a given event. Deleting a row means the member unregistered.';

create index idx_event_registrations_event_id on umsuka.event_registrations (event_id);
create index idx_event_registrations_user_id on umsuka.event_registrations (user_id);
