-- =========================================================
-- UMSUKA IMBALI APP — 0003: events
-- =========================================================

create table umsuka.events (
    id uuid default gen_random_uuid() primary key,
    title text not null,
    description text,
    event_type text not null
        check (
            event_type in (
                'general',
                'meeting',
                'carnival'
            )
        ),
    event_date timestamptz not null,
    created_by uuid references auth.users(id),
    created_at timestamptz default now()
);

comment on table umsuka.events is 'Association events (general activities, board meetings, carnival dates).';

create index idx_events_created_by on umsuka.events (created_by);
create index idx_events_event_date on umsuka.events (event_date);
create index idx_events_event_type on umsuka.events (event_type);
