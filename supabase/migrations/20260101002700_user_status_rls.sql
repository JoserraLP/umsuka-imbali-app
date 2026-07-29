-- =========================================================
-- UMSUKA IMBALI APP — 0027: user status RLS policies
-- =========================================================
-- Tightens RLS so that users with status 'pending' or 'suspended'
-- can only see their own profile row, and cannot read any
-- other table (events, shifts, attendance, etc.).

-- ---------------------------------------------------------
-- 1. Helper: is_active_member()
--    Returns true only when status = 'active' AND is_active = true.
--    SECURITY DEFINER so it can be used in profiles policies
--    without triggering recursive RLS.
-- ---------------------------------------------------------
create or replace function umsuka.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select coalesce(
    (select status = 'active' and is_active = true
     from umsuka.profiles
     where id = auth.uid()),
    false
  );
$$;

comment on function umsuka.is_active_member() is
  'True if the current user has status = active and is_active = true.';

grant execute on function umsuka.is_active_member() to authenticated;

-- ---------------------------------------------------------
-- 2. Helper: current_user_status()
--    Lightweight function for middleware to check status.
-- ---------------------------------------------------------
create or replace function umsuka.current_user_status()
returns text
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select status::text from umsuka.profiles where id = auth.uid();
$$;

comment on function umsuka.current_user_status() is
  'Returns the raw status text (pending, active, suspended) of the current user, or null if no profile.';

grant execute on function umsuka.current_user_status() to authenticated;

-- ---------------------------------------------------------
-- 3. Update profiles SELECT policy
--    Active members see all profiles; pending/suspended see only own.
-- ---------------------------------------------------------
drop policy if exists "profiles_select_authenticated" on umsuka.profiles;

create policy "profiles_select_authenticated"
  on umsuka.profiles for select
  to authenticated
  using (umsuka.is_active_member() or id = auth.uid());

-- ---------------------------------------------------------
-- 4. Update events SELECT policy
-- ---------------------------------------------------------
drop policy if exists "events_select_authenticated" on umsuka.events;

create policy "events_select_authenticated"
  on umsuka.events for select
  to authenticated
  using (umsuka.is_active_member());

-- ---------------------------------------------------------
-- 5. Update shifts SELECT policy
-- ---------------------------------------------------------
drop policy if exists "shifts_select_authenticated" on umsuka.shifts;

create policy "shifts_select_authenticated"
  on umsuka.shifts for select
  to authenticated
  using (umsuka.is_active_member());

-- ---------------------------------------------------------
-- 6. Update shift_assignments SELECT policy
-- ---------------------------------------------------------
drop policy if exists "shift_assignments_select_own_or_management" on umsuka.shift_assignments;

create policy "shift_assignments_select_own_or_management"
  on umsuka.shift_assignments for select
  to authenticated
  using ((umsuka.is_active_member() and (user_id = auth.uid() or umsuka.is_management())));

-- ---------------------------------------------------------
-- 7. Update attendance SELECT policy
-- ---------------------------------------------------------
drop policy if exists "attendance_select_own_or_management" on umsuka.attendance;

create policy "attendance_select_own_or_management"
  on umsuka.attendance for select
  to authenticated
  using ((umsuka.is_active_member() and (user_id = auth.uid() or umsuka.is_management())));

-- ---------------------------------------------------------
-- 8. Update absences SELECT policy
-- ---------------------------------------------------------
drop policy if exists "absences_select_own_or_management" on umsuka.absences;

create policy "absences_select_own_or_management"
  on umsuka.absences for select
  to authenticated
  using ((umsuka.is_active_member() and (user_id = auth.uid() or umsuka.is_management())));

-- ---------------------------------------------------------
-- 9. Update news SELECT policy
-- ---------------------------------------------------------
drop policy if exists "news_select_authenticated" on umsuka.news;

create policy "news_select_authenticated"
  on umsuka.news for select
  to authenticated
  using (umsuka.is_active_member());

-- ---------------------------------------------------------
-- 10. Update questions SELECT policy
-- ---------------------------------------------------------
drop policy if exists "questions_select_authenticated" on umsuka.questions;

create policy "questions_select_authenticated"
  on umsuka.questions for select
  to authenticated
  using (umsuka.is_active_member());

-- ---------------------------------------------------------
-- 11. Update votings SELECT policy
-- ---------------------------------------------------------
drop policy if exists "votings_select_authenticated" on umsuka.votings;

create policy "votings_select_authenticated"
  on umsuka.votings for select
  to authenticated
  using (umsuka.is_active_member());

-- ---------------------------------------------------------
-- 12. Update voting_options SELECT policy
-- ---------------------------------------------------------
drop policy if exists "voting_options_select_authenticated" on umsuka.voting_options;

create policy "voting_options_select_authenticated"
  on umsuka.voting_options for select
  to authenticated
  using (umsuka.is_active_member());

-- ---------------------------------------------------------
-- 13. Update voting_votes SELECT policy
-- ---------------------------------------------------------
drop policy if exists "voting_votes_select_own_or_management" on umsuka.voting_votes;

create policy "voting_votes_select_own_or_management"
  on umsuka.voting_votes for select
  to authenticated
  using ((umsuka.is_active_member() and (user_id = auth.uid() or umsuka.is_management())));

-- ---------------------------------------------------------
-- 14. Update event_registrations SELECT policy
-- ---------------------------------------------------------
drop policy if exists "event_registrations_select_own_or_management" on umsuka.event_registrations;

create policy "event_registrations_select_active"
  on umsuka.event_registrations for select
  to authenticated
  using (umsuka.is_active_member());

-- ---------------------------------------------------------
-- 15. Update workgroup_attendance SELECT policy
-- ---------------------------------------------------------
drop policy if exists "workgroup_attendance_select_own_or_management" on umsuka.workgroup_attendance;

create policy "workgroup_attendance_select_own_or_management"
  on umsuka.workgroup_attendance for select
  to authenticated
  using ((umsuka.is_active_member() and (user_id = auth.uid() or umsuka.is_management())));
