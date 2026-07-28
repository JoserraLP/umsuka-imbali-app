-- =========================================================
-- UMSUKA IMBALI APP — 0019: workgroup_attendance
-- =========================================================

create table umsuka.workgroup_attendance (
    id uuid default gen_random_uuid() primary key,
    shift_id uuid not null references umsuka.shifts(id)
        on delete cascade,
    user_id uuid not null references auth.users(id)
        on delete cascade,
    workgroup text not null,
    attended boolean not null,
    marked_by uuid references auth.users(id),
    created_at timestamptz default now(),
    updated_at timestamptz default now(),
    unique (shift_id, user_id, workgroup)
);

comment on table umsuka.workgroup_attendance is
  'Records workgroup attendance per shift per member. Unique per (shift, user, workgroup).';

create index idx_workgroup_attendance_shift_id
    on umsuka.workgroup_attendance (shift_id);
create index idx_workgroup_attendance_user_id
    on umsuka.workgroup_attendance (user_id);
create index idx_workgroup_attendance_workgroup
    on umsuka.workgroup_attendance (workgroup);

create or replace function umsuka.update_updated_at_column()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_workgroup_attendance_updated_at
  before update on umsuka.workgroup_attendance
  for each row
  execute function umsuka.update_updated_at_column();
