-- =========================================================
-- UMSUKA IMBALI APP — 0008: news
-- =========================================================

create table umsuka.news (
    id uuid default gen_random_uuid() primary key,
    title text not null,
    content text not null,
    created_by uuid references auth.users(id),
    created_at timestamptz default now()
);

comment on table umsuka.news is 'Association news posts/announcements.';

create index idx_news_created_by on umsuka.news (created_by);
create index idx_news_created_at on umsuka.news (created_at desc);
