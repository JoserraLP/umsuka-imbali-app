-- =========================================================
-- UMSUKA IMBALI APP — 0043: component leads (Sprint 14)
-- =========================================================
-- Sprint 14 extension: component leads for /members.
--
-- Workgroup leads can already open the /members directory scoped to
-- their own group (migration 0042 added their detail-page RLS reads).
-- This migration adds the "responsable de música" / "responsable de
-- baile" designation so a component lead can open /members scoped to
-- the members of their OWN component (music/dance), filtering by
-- workgroup within it.
--
-- 1. umsuka.profiles gains `component_lead_for` (text, nullable) with a
--    CHECK restricting values to 'music'/'dance' (no ENUM: plain TEXT
--    compares with the function parameter without a cast).
-- 2. A partial UNIQUE index enforces at most one music lead and one
--    dance lead. The super admin manages this designation in
--    /admin/users; the app layer converts the 23505 unique violation
--    into a friendly Spanish message.
-- 3. umsuka.is_component_lead(text) mirrors is_workgroup_lead() (same
--    security definer / search_path / grant pattern, migration 0024).
-- 4. Additive SELECT policies on shift_assignments and attendance so a
--    component lead can read the shifts/attendance of the members of
--    their OWN component in the member detail page. Existing policies
--    are NOT dropped or modified — PostgreSQL ORs multiple SELECT
--    policies, so these extend rather than restrict access.
--
-- umsuka.profiles' SELECT policy is NOT touched (same decision as
-- migration 0042): component scoping for /members is enforced at the
-- app layer in src/lib/members/authorization.ts.

-- ---------------------------------------------------------
-- 1. profiles.component_lead_for column
-- ---------------------------------------------------------
alter table umsuka.profiles add column component_lead_for text;

-- ---------------------------------------------------------
-- 2. CHECK constraint (null or one of the leadable components)
-- ---------------------------------------------------------
alter table umsuka.profiles
  add constraint profiles_component_lead_for_check
  check (component_lead_for is null or component_lead_for in ('music', 'dance'));

comment on constraint profiles_component_lead_for_check on umsuka.profiles is
  'component_lead_for must be null, ''music'' or ''dance'' (the responsable de música / responsable de baile designation).';

-- ---------------------------------------------------------
-- 3. Partial unique index: at most one lead per component
-- ---------------------------------------------------------
create unique index idx_profiles_component_lead_for
  on umsuka.profiles (component_lead_for)
  where component_lead_for is not null;

comment on index umsuka.idx_profiles_component_lead_for is
  'At most one responsible (lead) can be designated per component (music, dance).';

-- ---------------------------------------------------------
-- 4. umsuka.is_component_lead(text) helper (mirrors 0024)
-- ---------------------------------------------------------
create or replace function umsuka.is_component_lead(check_component text)
returns boolean
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select coalesce(
    (select component_lead_for = check_component
       from umsuka.profiles
      where id = auth.uid()),
    false
  );
$$;

comment on function umsuka.is_component_lead(text) is
  'Returns true if the current user is the responsible (lead) of the given component (music/dance).';

grant execute on function umsuka.is_component_lead(text) to authenticated;

-- ---------------------------------------------------------
-- 5. shift_assignments: component leads read assignments of
--    members of their component
-- ---------------------------------------------------------
drop policy if exists "shift_assignments_select_component_lead" on umsuka.shift_assignments;

create policy "shift_assignments_select_component_lead"
  on umsuka.shift_assignments for select
  to authenticated
  using (
    umsuka.is_active_member()
    and exists (
      select 1 from umsuka.profiles p
      where p.id = shift_assignments.user_id
        and umsuka.is_component_lead(p.component_type::text)
    )
  );

comment on policy "shift_assignments_select_component_lead" on umsuka.shift_assignments is
  'Component leads (music/dance) can read shift assignments of members of their own component (Sprint 14 member detail).';

-- ---------------------------------------------------------
-- 6. attendance: component leads read attendance of members
--    of their component
-- ---------------------------------------------------------
drop policy if exists "attendance_select_component_lead" on umsuka.attendance;

create policy "attendance_select_component_lead"
  on umsuka.attendance for select
  to authenticated
  using (
    umsuka.is_active_member()
    and exists (
      select 1 from umsuka.profiles p
      where p.id = attendance.user_id
        and umsuka.is_component_lead(p.component_type::text)
    )
  );

comment on policy "attendance_select_component_lead" on umsuka.attendance is
  'Component leads (music/dance) can read attendance of members of their own component (Sprint 14 member detail).';
