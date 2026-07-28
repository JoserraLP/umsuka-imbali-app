-- =========================================================
-- UMSUKA IMBALI APP — 0007: absences
-- =========================================================

create table umsuka.absences (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users(id)
        on delete cascade,
    event_id uuid references umsuka.events(id),
    reason text,
    justified boolean default false,
    created_at timestamptz default now()
);

comment on table umsuka.absences is 'Absence requests/records raised by a member for a given event.';

create index idx_absences_user_id on umsuka.absences (user_id);
create index idx_absences_event_id on umsuka.absences (event_id);
create index idx_absences_justified on umsuka.absences (justified);
