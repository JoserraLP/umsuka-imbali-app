-- =========================================================
-- UMSUKA IMBALI APP — 0025: instagram_posts cache
-- Sprint 4 — Home Feed: Instagram posts cache table
-- =========================================================

-- 1. Create the cache table
create table umsuka.instagram_posts (
    id          serial primary key,
    post_id     text not null unique,
    caption     text,
    media_url   text not null,
    permalink   text not null,
    media_type  text not null default 'image'
        check (media_type in ('image', 'video', 'carousel')),
    "timestamp" timestamptz not null,
    cached_at   timestamptz default now()
);

comment on table umsuka.instagram_posts is
    'Cached Instagram posts fetched via the Basic Display API. Refreshed periodically.';

create index idx_instagram_posts_timestamp on umsuka.instagram_posts ("timestamp" desc);

-- 2. Enable RLS
alter table umsuka.instagram_posts enable row level security;
alter table umsuka.instagram_posts force row level security;

-- 3. RLS: all authenticated users can read
create policy "instagram_posts_select_authenticated"
    on umsuka.instagram_posts for select
    to authenticated
    using (true);

-- 4. No write policies for authenticated — only service_role via admin client
--    Insert/update/delete are handled by the backend service using the admin client
--    (createAdminClient bypasses RLS entirely).
