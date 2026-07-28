-- =========================================================
-- UMSUKA IMBALI APP — 0012: voting_votes
-- =========================================================

create table umsuka.voting_votes (
    id uuid default gen_random_uuid() primary key,
    voting_id uuid references umsuka.votings(id)
        on delete cascade,
    option_id uuid references umsuka.voting_options(id)
        on delete cascade,
    user_id uuid references auth.users(id)
        on delete cascade,
    created_at timestamptz default now(),
    unique (voting_id, user_id)
);

comment on table umsuka.voting_votes is 'One vote per member per voting process. Immutable once cast (enforced by RLS).';

create index idx_voting_votes_voting_id on umsuka.voting_votes (voting_id);
create index idx_voting_votes_option_id on umsuka.voting_votes (option_id);
create index idx_voting_votes_user_id on umsuka.voting_votes (user_id);
