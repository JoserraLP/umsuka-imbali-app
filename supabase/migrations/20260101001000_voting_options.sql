-- =========================================================
-- UMSUKA IMBALI APP — 0011: voting_options
-- =========================================================

create table umsuka.voting_options (
    id uuid default gen_random_uuid() primary key,
    voting_id uuid references umsuka.votings(id)
        on delete cascade,
    option_text text not null
);

comment on table umsuka.voting_options is 'Selectable options belonging to a voting process.';

create index idx_voting_options_voting_id on umsuka.voting_options (voting_id);
