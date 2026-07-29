-- =========================================================
-- UMSUKA IMBALI APP — 0024: event_type ENUM
-- =========================================================
-- Creates a dedicated PostgreSQL ENUM for event_type and
-- migrates the events table from a text column with a CHECK
-- constraint to the typed ENUM. This is more maintainable
-- than repeatedly dropping/recreating CHECK constraints.
--
-- Safe to run multiple times (idempotent).

-- ---------------------------------------------------------
-- 1. Create ENUM if it does not already exist
-- ---------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_type
    where typname = 'event_type'
      and typnamespace = (select oid from pg_namespace where nspname = 'umsuka')
  ) then
    create type umsuka.event_type as enum (
      'general',
      'meeting',
      'carnival',
      'work_shift'
    );
  end if;
end
$$;

-- ---------------------------------------------------------
-- 2. Drop all CHECK constraints on events.event_type
--    (there may be an old one and a newer one if previous
--     migrations ran partially)
-- ---------------------------------------------------------
do $$
declare
  con record;
begin
  for con in
    select conname
    from   pg_constraint
    where  conrelid = 'umsuka.events'::regclass
      and  contype = 'c'
      and  pg_get_constraintdef(oid) ~* 'event_type'
  loop
    execute format('alter table umsuka.events drop constraint %I', con.conname);
  end loop;
end
$$;

-- ---------------------------------------------------------
-- 3. Alter the column type from text → umsuka.event_type
--    USING clause casts existing text values to the enum
-- ---------------------------------------------------------
alter table umsuka.events
  alter column event_type type umsuka.event_type
  using event_type::umsuka.event_type;

-- ---------------------------------------------------------
-- 4. Set a default (general is the safest default)
-- ---------------------------------------------------------
alter table umsuka.events
  alter column event_type set default 'general'::umsuka.event_type;

comment on column umsuka.events.event_type is
  'Type of event: general, meeting, carnival, or work_shift (workgroup shift attendance).';

-- ---------------------------------------------------------
-- 5. Keep the TypeScript types in sync — update the comment
--    so regenerated types include the ENUM
-- ---------------------------------------------------------
comment on type umsuka.event_type is
  'Event category enum: general, meeting, carnival, work_shift.';
