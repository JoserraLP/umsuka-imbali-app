-- =========================================================
-- UMSUKA IMBALI APP — 0020: workgroup helper functions + RLS
-- =========================================================

create or replace function umsuka.is_workgroup_lead(check_workgroup text)
returns boolean
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select coalesce(
    (select is_workgroup_lead
       from umsuka.profiles
      where id = auth.uid() and workgroup = check_workgroup),
    false
  );
$$;

comment on function umsuka.is_workgroup_lead(text) is
  'Returns true if the current user is the lead of the given workgroup.';

create or replace function umsuka.current_user_workgroup()
returns text
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select workgroup from umsuka.profiles where id = auth.uid();
$$;

comment on function umsuka.current_user_workgroup() is
  'Returns the workgroup of the currently authenticated user.';

create or replace function umsuka.is_super_admin()
returns boolean
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select coalesce(
    (select role from umsuka.profiles where id = auth.uid()) = 'super_admin',
    false
  );
$$;

comment on function umsuka.is_super_admin() is
  'True if the current user has role super_admin (not admin).';

grant execute on function umsuka.is_workgroup_lead(text) to authenticated;
grant execute on function umsuka.current_user_workgroup() to authenticated;
grant execute on function umsuka.is_super_admin() to authenticated;

-- ---------------------------------------------------------
-- RLS for workgroup_attendance
-- ---------------------------------------------------------
alter table umsuka.workgroup_attendance enable row level security;
alter table umsuka.workgroup_attendance force row level security;

create policy "workgroup_attendance_select"
  on umsuka.workgroup_attendance for select
  to authenticated
  using (
    user_id = auth.uid()
    or umsuka.is_workgroup_lead(workgroup)
    or umsuka.is_super_admin()
  );

create policy "workgroup_attendance_insert"
  on umsuka.workgroup_attendance for insert
  to authenticated
  with check (
    umsuka.is_workgroup_lead(workgroup)
    or umsuka.is_super_admin()
  );

create policy "workgroup_attendance_update"
  on umsuka.workgroup_attendance for update
  to authenticated
  using (
    umsuka.is_workgroup_lead(workgroup)
    or umsuka.is_super_admin()
  )
  with check (
    umsuka.is_workgroup_lead(workgroup)
    or umsuka.is_super_admin()
  );

create policy "workgroup_attendance_delete"
  on umsuka.workgroup_attendance for delete
  to authenticated
  using (
    umsuka.is_workgroup_lead(workgroup)
    or umsuka.is_super_admin()
  );
