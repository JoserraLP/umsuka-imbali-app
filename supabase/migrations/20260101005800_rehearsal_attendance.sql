-- =========================================================
-- UMSUKA IMBALI APP — 0058: rehearsal attendance (Sprint 27)
-- =========================================================
-- Per-session attendance for rehearsal events: management marks each
-- member as present/absent for the morning and/or afternoon session of
-- a 'rehearsal' event; per-user aggregates feed /profile and the
-- member detail page.
--
-- Design decisions:
--   1. Sessions are two booleans on umsuka.events (morning_session /
--      afternoon_session) guarded by CHECKs so that a rehearsal always
--      declares at least one session and no other event type ever has
--      sessions. The attendance table references the declared session
--      via the umsuka.rehearsal_session enum; the app layer re-validates
--      fail-closed before writing (src/lib/rehearsals/mutations.ts).
--   2. "One attendance row per member, event and session" is enforced by
--      a UNIQUE constraint on (event_id, user_id, session); marking
--      again upserts onto the same row (onConflict in the app layer).
--   3. marked_by records WHO marked the attendance (always the acting
--      manager); ON DELETE SET NULL keeps history when the marker's
--      account disappears.
--   4. RLS follows the 0013 baseline pattern: a member reads their own
--      rows, management reads everything via umsuka.is_management();
--      writes are restricted to management roles. FORCE RLS keeps the
--      table protected even against table owners.
--   5. umsuka.update_updated_at_column() already exists (0018), reused
--      verbatim by the trigger.

-- ---------------------------------------------------------
-- 1. Session columns on umsuka.events + CHECK guards
-- ---------------------------------------------------------
alter table umsuka.events
  add column morning_session boolean not null default false,
  add column afternoon_session boolean not null default false;

comment on column umsuka.events.morning_session is
  'rehearsal events only: the event has a morning session open for attendance.';
comment on column umsuka.events.afternoon_session is
  'rehearsal events only: the event has an afternoon session open for attendance.';

-- A rehearsal must declare at least one session...
alter table umsuka.events
  add constraint chk_events_rehearsal_has_session
    check (event_type <> 'rehearsal' or morning_session or afternoon_session);

-- ...and any other event type must never declare one.
alter table umsuka.events
  add constraint chk_events_non_rehearsal_no_sessions
    check (event_type = 'rehearsal' or (not morning_session and not afternoon_session));

-- ---------------------------------------------------------
-- 2. umsuka.rehearsal_session enum
-- ---------------------------------------------------------
create type umsuka.rehearsal_session as enum ('morning', 'afternoon');

comment on type umsuka.rehearsal_session is
  'Session of a rehearsal event: morning or afternoon.';

-- ---------------------------------------------------------
-- 3. umsuka.rehearsal_attendance
-- ---------------------------------------------------------
create table umsuka.rehearsal_attendance (
    id uuid default gen_random_uuid() primary key,
    event_id uuid not null references umsuka.events(id)
        on delete cascade,
    user_id uuid not null references auth.users(id)
        on delete cascade,
    session umsuka.rehearsal_session not null,
    attended boolean not null,
    marked_by uuid references auth.users(id)
        on delete set null,
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    constraint rehearsal_attendance_event_user_session_unique
        unique (event_id, user_id, session)
);

comment on table umsuka.rehearsal_attendance is
  'Per-session attendance for rehearsal events: one row per member, event and session (unique). Marking again upserts onto the same row.';
comment on column umsuka.rehearsal_attendance.session is
  'Which rehearsal session the row refers to (morning/afternoon); the event must declare that session (app-layer fail-closed check).';
comment on column umsuka.rehearsal_attendance.attended is
  'true = the member attended that session; false = marked absent.';
comment on column umsuka.rehearsal_attendance.marked_by is
  'Profile of the manager who last marked the attendance; null when that account was deleted.';

create index idx_rehearsal_attendance_event_session
    on umsuka.rehearsal_attendance (event_id, session);
create index idx_rehearsal_attendance_user_id
    on umsuka.rehearsal_attendance (user_id);

-- ---------------------------------------------------------
-- 4. updated_at trigger (0018 helper, idempotent)
-- ---------------------------------------------------------
drop trigger if exists trg_rehearsal_attendance_updated_at on umsuka.rehearsal_attendance;

create trigger trg_rehearsal_attendance_updated_at
  before update on umsuka.rehearsal_attendance
  for each row
  execute function umsuka.update_updated_at_column();

-- ---------------------------------------------------------
-- 5. RLS
-- ---------------------------------------------------------
alter table umsuka.rehearsal_attendance enable row level security;
alter table umsuka.rehearsal_attendance force row level security;

create policy "rehearsal_attendance_select_own_or_management"
  on umsuka.rehearsal_attendance for select
  to authenticated
  using (user_id = auth.uid() or umsuka.is_management());

-- INSERT/UPDATE/DELETE are covered by the FOR ALL policy only
-- (management); SELECT policies are OR-combined, so members keep
-- read access to their own rows through the SELECT policy above.
create policy "rehearsal_attendance_write_management"
  on umsuka.rehearsal_attendance for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (no Supabase local/CLI in this environment; SQL is
-- hand-reasoned — pattern of the previous sprints). Verify before deploy:
--
-- [ ] umsuka.events gains morning_session / afternoon_session (boolean,
--       NOT NULL, default false) with comments.
-- [ ] chk_events_rehearsal_has_session rejects inserting a 'rehearsal'
--       event with both sessions false, and accepts either or both true.
-- [ ] chk_events_non_rehearsal_no_sessions rejects setting
--       morning_session/afternoon_session on a non-rehearsal event
--       (general/meeting/carnival/work_shift keep working untouched).
-- [ ] umsuka.rehearsal_session exists with values morning, afternoon
--       (in that order).
-- [ ] rehearsal_attendance_event_user_unique... i.e.
--       rehearsal_attendance_event_user_session_unique rejects a second
--       row for the same (event_id, user_id, session) with 23505 while
--       the same member can hold a morning AND an afternoon row.
-- [ ] idx_rehearsal_attendance_event_session and
--       idx_rehearsal_attendance_user_id exist (panel + profile stats).
-- [ ] trg_rehearsal_attendance_updated_at fires on UPDATE via
--       umsuka.update_updated_at_column() (0018) and is idempotent on
--       re-run (drop trigger if exists).
-- [ ] RLS (FORCE): a member SELECTs their own rows but gets an empty
--       result for other members'; writes by non-management roles are
--       rejected with 'new row violates row-level security policy';
--       management passes via umsuka.is_management().
-- [ ] FK cascades: deleting an event removes its attendance rows;
--       deleting an auth user removes theirs; deleting the marker sets
--       marked_by to null without touching the row.
-- [ ] supabase db push applies the migration AFTER 0057; re-running it
--       is safe.
-- ---------------------------------------------------------
