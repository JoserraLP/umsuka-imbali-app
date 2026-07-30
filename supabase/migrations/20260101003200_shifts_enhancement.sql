-- =========================================================
-- UMSUKA IMBALI APP — 0033: shifts enhancement
-- =========================================================
-- Enhances umsuka.shifts with max_assignees, workgroup, and
-- notes columns. Adds RLS policies for both shifts and
-- shift_assignments tables.

-- ---------------------------------------------------------
-- 1. Add columns to umsuka.shifts
-- ---------------------------------------------------------
alter table umsuka.shifts
  add column if not exists max_assignees int
    check (max_assignees is null or max_assignees > 0);

alter table umsuka.shifts
  add column if not exists workgroup umsuka.workgroup;

alter table umsuka.shifts
  add column if not exists notes text;

comment on column umsuka.shifts.max_assignees is
  'Optional limit on how many members can be assigned to this shift. null = unlimited.';
comment on column umsuka.shifts.workgroup is
  'Optional workgroup filter: if set, only members with this workgroup can be assigned.';
comment on column umsuka.shifts.notes is
  'Internal notes about the shift (visible to management).';

-- ---------------------------------------------------------
-- 2. Enable RLS (idempotent)
-- ---------------------------------------------------------
alter table umsuka.shifts enable row level security;
alter table umsuka.shift_assignments enable row level security;

-- ---------------------------------------------------------
-- 3. Helper function: is_workgroup_lead_for_event
-- ---------------------------------------------------------
-- Returns true if the current user is a workgroup lead AND
-- the specified event is a work_shift event created by them.
-- Used in RLS policies to allow workgroup leads to manage
-- shifts for their own work_shift events.
create or replace function umsuka.is_workgroup_lead_for_event(event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select exists (
    select 1
    from umsuka.profiles p
    join umsuka.events e on e.id = event_id
    where p.id = auth.uid()
      and p.is_workgroup_lead = true
      and e.event_type = 'work_shift'
      and e.created_by = auth.uid()
  );
$$;

comment on function umsuka.is_workgroup_lead_for_event is
  'True if the current user is a workgroup lead and the given event is a work_shift event they created.';

grant execute on function umsuka.is_workgroup_lead_for_event(uuid) to authenticated;

-- ---------------------------------------------------------
-- 4. RLS policies for umsuka.shifts
-- ---------------------------------------------------------
-- Management roles and workgroup leads (for their own work_shift events)
-- can manage shifts. All authenticated users can view them.

drop policy if exists "shifts_select_authenticated" on umsuka.shifts;
create policy "shifts_select_authenticated"
  on umsuka.shifts for select
  to authenticated
  using (true);

drop policy if exists "shifts_insert_management_or_lead" on umsuka.shifts;
create policy "shifts_insert_management_or_lead"
  on umsuka.shifts for insert
  to authenticated
  with check (
    umsuka.is_management()
    or umsuka.is_workgroup_lead_for_event(event_id)
  );

drop policy if exists "shifts_update_management_or_lead" on umsuka.shifts;
create policy "shifts_update_management_or_lead"
  on umsuka.shifts for update
  to authenticated
  using (
    umsuka.is_management()
    or umsuka.is_workgroup_lead_for_event(event_id)
  )
  with check (
    umsuka.is_management()
    or umsuka.is_workgroup_lead_for_event(event_id)
  );

drop policy if exists "shifts_delete_management_or_lead" on umsuka.shifts;
create policy "shifts_delete_management_or_lead"
  on umsuka.shifts for delete
  to authenticated
  using (
    umsuka.is_management()
    or umsuka.is_workgroup_lead_for_event(event_id)
  );

-- ---------------------------------------------------------
-- 5. RLS policies for umsuka.shift_assignments
-- ---------------------------------------------------------
-- Members can view their own assignments; management (and workgroup
-- leads for their work_shift events) can view, insert, and delete.
-- No UPDATE policy is defined because no current mutation performs
-- updates on shift_assignments. If a future feature adds an update
-- path (e.g. status changes), a corresponding policy should be added.

drop policy if exists "shift_assignments_select_own_or_management" on umsuka.shift_assignments;
create policy "shift_assignments_select_own_or_management"
  on umsuka.shift_assignments for select
  to authenticated
  using (user_id = auth.uid() or umsuka.is_management());

-- Workgroup leads can also see assignments for shifts in their events
drop policy if exists "shift_assignments_select_lead" on umsuka.shift_assignments;
create policy "shift_assignments_select_lead"
  on umsuka.shift_assignments for select
  to authenticated
  using (
    exists (
      select 1 from umsuka.shifts s
      where s.id = shift_id
        and umsuka.is_workgroup_lead_for_event(s.event_id)
    )
  );

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
    )
  );

-- ---------------------------------------------------------
-- 6. Indexes
-- ---------------------------------------------------------
create index if not exists idx_shifts_workgroup on umsuka.shifts (workgroup);
create index if not exists idx_shifts_start_time_end_time on umsuka.shifts (start_time, end_time);
