-- =========================================================
-- UMSUKA IMBALI APP — 0004: shifts
-- =========================================================

create table umsuka.shifts (
    id uuid default gen_random_uuid() primary key,
    event_id uuid references umsuka.events(id)
        on delete cascade,
    name text not null,
    start_time timestamptz not null,
    end_time timestamptz not null,
    created_at timestamptz default now()
);

comment on table umsuka.shifts is 'Work shifts belonging to an event, to be staffed via shift_assignments.';

create index idx_shifts_event_id on umsuka.shifts (event_id);
create index idx_shifts_start_time on umsuka.shifts (start_time);
