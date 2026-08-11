-- =========================================================
-- UMSUKA IMBALI APP — 0042: member detail lead reads (Sprint 14)
-- =========================================================
-- Sprint 14: /members directory for management + workgroup leads.
--
-- The detail page reuses getMyAssignedShifts() and getUserAttendance(),
-- which read umsuka.shift_assignments and umsuka.attendance through the
-- anon client. Existing SELECT policies only allow the record owner or
-- management to read those rows. This migration adds additive SELECT
-- policies so a workgroup lead can also read the shifts/attendance of the
-- members of their OWN workgroup (never other groups).
--
-- IMPORTANT (additive only):
--   * Existing policies are NOT dropped or modified.
--   * umsuka.profiles' SELECT policy is NOT touched: any active member
--     may still read profile rows (needed by news/questions/events
--     enrichment), lead scoping for /members is enforced at the app
--     layer in src/lib/members/authorization.ts.
--
-- Multiple SELECT policies on a table are OR-ed by PostgreSQL, so these
-- new policies extend rather than restrict access.

-- ---------------------------------------------------------
-- 1. shift_assignments: leads read assignments of their group
-- ---------------------------------------------------------
drop policy if exists "shift_assignments_select_lead_workgroup" on umsuka.shift_assignments;

create policy "shift_assignments_select_lead_workgroup"
  on umsuka.shift_assignments for select
  to authenticated
  using (
    umsuka.is_active_member()
    and exists (
      select 1 from umsuka.profiles p
      where p.id = shift_assignments.user_id
        and umsuka.is_workgroup_lead(p.workgroup::text)
    )
  );

comment on policy "shift_assignments_select_lead_workgroup" on umsuka.shift_assignments is
  'Workgroup leads can read shift assignments of members of their own workgroup (Sprint 14 member detail).';

-- ---------------------------------------------------------
-- 2. attendance: leads read attendance of their group
-- ---------------------------------------------------------
drop policy if exists "attendance_select_lead_workgroup" on umsuka.attendance;

create policy "attendance_select_lead_workgroup"
  on umsuka.attendance for select
  to authenticated
  using (
    umsuka.is_active_member()
    and exists (
      select 1 from umsuka.profiles p
      where p.id = attendance.user_id
        and umsuka.is_workgroup_lead(p.workgroup::text)
    )
  );

comment on policy "attendance_select_lead_workgroup" on umsuka.attendance is
  'Workgroup leads can read attendance of members of their own workgroup (Sprint 14 member detail).';
