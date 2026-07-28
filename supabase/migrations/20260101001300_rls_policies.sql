-- =========================================================
-- UMSUKA IMBALI APP — 0014: Row Level Security
-- =========================================================
-- Baseline, module-agnostic RLS. Every table is readable by any
-- authenticated member (directory-style transparency, matching the
-- association's internal-transparency model) and writable only by
-- privileged roles or the owning member, as noted per table. When each
-- business module is implemented, its policies may be tightened further
-- (never loosened) in a dedicated migration.

-- ---------------------------------------------------------
-- Helper functions (SECURITY DEFINER to avoid recursive RLS lookups
-- against umsuka.profiles from within its own policies).
-- ---------------------------------------------------------
create or replace function umsuka.current_user_role()
returns text
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select role from umsuka.profiles where id = auth.uid();
$$;

comment on function umsuka.current_user_role() is
  'Returns the role of the currently authenticated user, or null if unauthenticated / no profile row exists.';

create or replace function umsuka.is_admin()
returns boolean
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select coalesce(
    (select role from umsuka.profiles where id = auth.uid()) in ('super_admin', 'admin'),
    false
  );
$$;

comment on function umsuka.is_admin() is 'True if the current user has role super_admin or admin.';

create or replace function umsuka.is_management()
returns boolean
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select coalesce(
    (select role from umsuka.profiles where id = auth.uid())
      in ('super_admin', 'admin', 'board_member', 'event_manager'),
    false
  );
$$;

comment on function umsuka.is_management() is
  'True if the current user holds an operational-management role (super_admin, admin, board_member, event_manager).';

grant execute on function umsuka.current_user_role() to authenticated;
grant execute on function umsuka.is_admin() to authenticated;
grant execute on function umsuka.is_management() to authenticated;

-- ---------------------------------------------------------
-- profiles
-- ---------------------------------------------------------
alter table umsuka.profiles enable row level security;
alter table umsuka.profiles force row level security;

create policy "profiles_select_authenticated"
  on umsuka.profiles for select
  to authenticated
  using (true);

create policy "profiles_update_own_or_admin"
  on umsuka.profiles for update
  to authenticated
  using (id = auth.uid() or umsuka.is_admin())
  with check (id = auth.uid() or umsuka.is_admin());

create policy "profiles_delete_admin"
  on umsuka.profiles for delete
  to authenticated
  using (umsuka.is_admin());

-- No INSERT policy for authenticated/anon: rows are created exclusively
-- by umsuka.handle_new_user() (SECURITY DEFINER) or the service role.

-- ---------------------------------------------------------
-- events
-- ---------------------------------------------------------
alter table umsuka.events enable row level security;
alter table umsuka.events force row level security;

create policy "events_select_authenticated"
  on umsuka.events for select
  to authenticated
  using (true);

create policy "events_write_management"
  on umsuka.events for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

-- ---------------------------------------------------------
-- shifts
-- ---------------------------------------------------------
alter table umsuka.shifts enable row level security;
alter table umsuka.shifts force row level security;

create policy "shifts_select_authenticated"
  on umsuka.shifts for select
  to authenticated
  using (true);

create policy "shifts_write_management"
  on umsuka.shifts for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

-- ---------------------------------------------------------
-- shift_assignments
-- ---------------------------------------------------------
alter table umsuka.shift_assignments enable row level security;
alter table umsuka.shift_assignments force row level security;

create policy "shift_assignments_select_own_or_management"
  on umsuka.shift_assignments for select
  to authenticated
  using (user_id = auth.uid() or umsuka.is_management());

create policy "shift_assignments_write_management"
  on umsuka.shift_assignments for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

-- ---------------------------------------------------------
-- attendance
-- ---------------------------------------------------------
alter table umsuka.attendance enable row level security;
alter table umsuka.attendance force row level security;

create policy "attendance_select_own_or_management"
  on umsuka.attendance for select
  to authenticated
  using (user_id = auth.uid() or umsuka.is_management());

create policy "attendance_write_management"
  on umsuka.attendance for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

-- ---------------------------------------------------------
-- absences
-- ---------------------------------------------------------
alter table umsuka.absences enable row level security;
alter table umsuka.absences force row level security;

create policy "absences_select_own_or_management"
  on umsuka.absences for select
  to authenticated
  using (user_id = auth.uid() or umsuka.is_management());

create policy "absences_insert_own"
  on umsuka.absences for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "absences_update_management"
  on umsuka.absences for update
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

create policy "absences_delete_management"
  on umsuka.absences for delete
  to authenticated
  using (umsuka.is_management());

-- ---------------------------------------------------------
-- news
-- ---------------------------------------------------------
alter table umsuka.news enable row level security;
alter table umsuka.news force row level security;

create policy "news_select_authenticated"
  on umsuka.news for select
  to authenticated
  using (true);

create policy "news_write_management"
  on umsuka.news for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

-- ---------------------------------------------------------
-- questions
-- ---------------------------------------------------------
alter table umsuka.questions enable row level security;
alter table umsuka.questions force row level security;

create policy "questions_select_authenticated"
  on umsuka.questions for select
  to authenticated
  using (true);

create policy "questions_insert_own"
  on umsuka.questions for insert
  to authenticated
  with check (user_id = auth.uid());

create policy "questions_update_own_or_management"
  on umsuka.questions for update
  to authenticated
  using (user_id = auth.uid() or umsuka.is_management())
  with check (user_id = auth.uid() or umsuka.is_management());

create policy "questions_delete_management"
  on umsuka.questions for delete
  to authenticated
  using (umsuka.is_management());

-- ---------------------------------------------------------
-- votings
-- ---------------------------------------------------------
alter table umsuka.votings enable row level security;
alter table umsuka.votings force row level security;

create policy "votings_select_authenticated"
  on umsuka.votings for select
  to authenticated
  using (true);

create policy "votings_write_management"
  on umsuka.votings for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

-- ---------------------------------------------------------
-- voting_options
-- ---------------------------------------------------------
alter table umsuka.voting_options enable row level security;
alter table umsuka.voting_options force row level security;

create policy "voting_options_select_authenticated"
  on umsuka.voting_options for select
  to authenticated
  using (true);

create policy "voting_options_write_management"
  on umsuka.voting_options for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

-- ---------------------------------------------------------
-- voting_votes
-- ---------------------------------------------------------
alter table umsuka.voting_votes enable row level security;
alter table umsuka.voting_votes force row level security;

create policy "voting_votes_select_own_or_management"
  on umsuka.voting_votes for select
  to authenticated
  using (user_id = auth.uid() or umsuka.is_management());

create policy "voting_votes_insert_own"
  on umsuka.voting_votes for insert
  to authenticated
  with check (user_id = auth.uid());

-- Votes are immutable once cast: no UPDATE policy for authenticated users.

create policy "voting_votes_delete_management"
  on umsuka.voting_votes for delete
  to authenticated
  using (umsuka.is_management());
