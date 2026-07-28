-- =========================================================
-- UMSUKA IMBALI APP — 0006: attendance
-- =========================================================

create table umsuka.attendance (
    id uuid default gen_random_uuid() primary key,
    event_id uuid references umsuka.events(id)
        on delete cascade,
    user_id uuid references auth.users(id)
        on delete cascade,
    attended boolean not null,
    created_at timestamptz default now(),
    unique (event_id, user_id)
);

comment on table umsuka.attendance is 'Records whether a member attended a given event. Unique per (event, member).';

create index idx_attendance_event_id on umsuka.attendance (event_id);
create index idx_attendance_user_id on umsuka.attendance (user_id);
