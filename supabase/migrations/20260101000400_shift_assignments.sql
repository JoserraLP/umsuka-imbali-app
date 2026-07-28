-- =========================================================
-- UMSUKA IMBALI APP — 0005: shift_assignments
-- =========================================================

create table umsuka.shift_assignments (
    id uuid default gen_random_uuid() primary key,
    shift_id uuid references umsuka.shifts(id)
        on delete cascade,
    user_id uuid references auth.users(id)
        on delete cascade,
    created_at timestamptz default now(),
    unique (shift_id, user_id)
);

comment on table umsuka.shift_assignments is 'Assigns a member to a specific shift. Unique per (shift, member).';

create index idx_shift_assignments_shift_id on umsuka.shift_assignments (shift_id);
create index idx_shift_assignments_user_id on umsuka.shift_assignments (user_id);
