-- =========================================================
-- UMSUKA IMBALI APP — 0041: shift assignment groups
-- =========================================================
-- Sprint 12: concrete member-to-shift assignments and
-- workgroup-scoped work_shift events.
--
-- 1. umsuka.shift_assignments gains `confirmed` and `created_by`.
-- 2. umsuka.events gains `visible_to_group` and `created_by_workgroup`.
-- 3. RLS: workgroup leads can create/update/delete their own
--    work_shift events; event SELECT is filtered by group visibility.

-- ---------------------------------------------------------
-- 1. shift_assignments: confirmed + created_by
-- ---------------------------------------------------------
alter table umsuka.shift_assignments
  add column if not exists confirmed boolean not null default false;

alter table umsuka.shift_assignments
  add column if not exists created_by uuid references auth.users(id)
    on delete set null;

comment on column umsuka.shift_assignments.confirmed is
  'Whether the assigned member has confirmed they will cover the shift.';
comment on column umsuka.shift_assignments.created_by is
  'User (management or workgroup lead) who created the assignment.';

-- The unique (shift_id, user_id) constraint and the user_id index already
-- exist from the base table (20260101000400_shift_assignments.sql).

-- ---------------------------------------------------------
-- 2. events: workgroup visibility columns
-- ---------------------------------------------------------
alter table umsuka.events
  add column if not exists visible_to_group umsuka.workgroup;

alter table umsuka.events
  add column if not exists created_by_workgroup umsuka.workgroup;

comment on column umsuka.events.visible_to_group is
  'If set, only members of this workgroup can see the event. null = visible to everyone.';
comment on column umsuka.events.created_by_workgroup is
  'Workgroup of the lead who created the event (work_shift events). null for general events.';

create index if not exists idx_events_visible_to_group on umsuka.events (visible_to_group);
create index if not exists idx_events_created_by_workgroup on umsuka.events (created_by_workgroup);

-- ---------------------------------------------------------
-- 3. RLS — events: visibility + lead policies
-- ---------------------------------------------------------
-- SELECT: general events (visible_to_group IS NULL) are visible to
-- everyone; workgroup events only to members of that group. Management
-- always sees everything so it can manage group events.
drop policy if exists "events_select_authenticated" on umsuka.events;
create policy "events_select_authenticated"
  on umsuka.events for select
  to authenticated
  using (
    visible_to_group is null
    or visible_to_group::text = umsuka.current_user_workgroup()::text
    or umsuka.is_management()
  );

-- Workgroup leads can create their own work_shift events (created_by is
-- pinned to the caller so it cannot be spoofed).
drop policy if exists "events_insert_lead_work_shift" on umsuka.events;
create policy "events_insert_lead_work_shift"
  on umsuka.events for insert
  to authenticated
  with check (
    event_type = 'work_shift'
    and created_by = auth.uid()
    and umsuka.is_workgroup_lead(created_by_workgroup::text)
  );

-- Leads can update their own work_shift events; the new row must stay a
-- work_shift event of their group, so they cannot repurpose it.
drop policy if exists "events_update_lead_work_shift" on umsuka.events;
create policy "events_update_lead_work_shift"
  on umsuka.events for update
  to authenticated
  using (
    event_type = 'work_shift'
    and created_by = auth.uid()
    and umsuka.is_workgroup_lead(created_by_workgroup::text)
  )
  with check (
    event_type = 'work_shift'
    and created_by = auth.uid()
    and umsuka.is_workgroup_lead(created_by_workgroup::text)
  );

drop policy if exists "events_delete_lead_work_shift" on umsuka.events;
create policy "events_delete_lead_work_shift"
  on umsuka.events for delete
  to authenticated
  using (
    event_type = 'work_shift'
    and created_by = auth.uid()
    and umsuka.is_workgroup_lead(created_by_workgroup::text)
  );

-- ---------------------------------------------------------
-- 4. RLS — shift_assignments: lead scope
-- ---------------------------------------------------------
-- Leads can insert/delete assignments only for shifts on their own
-- work_shift events whose workgroup matches their own group (or has no
-- group filter, which only happens on events they created).
drop policy if exists "shift_assignments_insert_management_or_lead" on umsuka.shift_assignments;
create policy "shift_assignments_insert_management_or_lead"
  on umsuka.shift_assignments for insert
  to authenticated
  with check (
    umsuka.is_management()
    or exists (
      select 1 from umsuka.shifts s
      where s.id = shift_id
        and umsuka.is_workgroup_lead_for_event(s.event_id)
        and (s.workgroup is null or s.workgroup::text = umsuka.current_user_workgroup()::text)
    )
  );

drop policy if exists "shift_assignments_delete_management_or_lead" on umsuka.shift_assignments;
create policy "shift_assignments_delete_management_or_lead"
  on umsuka.shift_assignments for delete
  to authenticated
  using (
    umsuka.is_management()
    or exists (
      select 1 from umsuka.shifts s
      where s.id = shift_id
        and umsuka.is_workgroup_lead_for_event(s.event_id)
        and (s.workgroup is null or s.workgroup::text = umsuka.current_user_workgroup()::text)
    )
  );
