-- =========================================================
-- UMSUKA IMBALI APP — 0009: questions
-- =========================================================

create table umsuka.questions (
    id uuid default gen_random_uuid() primary key,
    user_id uuid references auth.users(id),
    title text not null,
    content text not null,
    resolved boolean default false,
    created_at timestamptz default now()
);

comment on table umsuka.questions is 'Questions raised by members, tracked to resolution by the board/admins.';

create index idx_questions_user_id on umsuka.questions (user_id);
create index idx_questions_resolved on umsuka.questions (resolved);
