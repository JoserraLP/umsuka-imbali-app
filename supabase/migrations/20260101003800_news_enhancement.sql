-- =========================================================
-- UMSUKA IMBALI APP — 0039: news enhancement (image, publish, pin)
-- =========================================================

alter table umsuka.news
  add column image_url text,
  add column published boolean not null default false,
  add column pinned boolean not null default false;

comment on column umsuka.news.image_url is 'Optional featured image URL';
comment on column umsuka.news.published is 'Draft/published control — only published news visible to non-management';
comment on column umsuka.news.pinned is 'Pin important news to top of feed';

create index idx_news_pinned on umsuka.news (pinned desc);

drop index if exists umsuka.idx_news_created_at;
create index idx_news_created_at on umsuka.news (created_at desc);

-- Update SELECT policy so non-management users can only see published news.
-- This is defense-in-depth: the application layer also filters, but the DB
-- enforces the rule at the row level as well.
drop policy if exists "news_select_authenticated" on umsuka.news;

create policy "news_select_authenticated"
  on umsuka.news for select
  to authenticated
  using (
    umsuka.is_management() OR published = true
  );
