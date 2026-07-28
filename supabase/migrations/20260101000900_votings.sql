-- =========================================================
-- UMSUKA IMBALI APP — 0010: votings
-- =========================================================

create table umsuka.votings (
    id uuid default gen_random_uuid() primary key,
    title text not null,
    description text,
    event_id uuid references umsuka.events(id),
    is_open boolean default true,
    created_at timestamptz default now()
);

comment on table umsuka.votings is 'A voting process, optionally tied to an event.';

create index idx_votings_event_id on umsuka.votings (event_id);
create index idx_votings_is_open on umsuka.votings (is_open);
