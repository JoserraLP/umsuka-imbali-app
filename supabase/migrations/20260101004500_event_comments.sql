-- =========================================================
-- UMSUKA IMBALI APP — 0045: event comments
-- =========================================================
-- Discussion thread for an event, mirroring the question_comments
-- pattern: every authenticated active member can read and write the
-- thread; the author or a management role can delete a comment.

create table umsuka.event_comments (
    id uuid default gen_random_uuid() primary key,
    event_id uuid not null references umsuka.events(id)
        on delete cascade,
    user_id uuid not null references auth.users(id)
        on delete cascade,
    body text not null check (length(trim(body)) > 0),
    created_at timestamptz default now()
);

comment on table umsuka.event_comments is
  'A member''s comment on an event page. Deleting an event cascades to its comments.';

create index idx_event_comments_event_id on umsuka.event_comments (event_id);
create index idx_event_comments_user_id on umsuka.event_comments (user_id);

-- ---------------------------------------------------------
-- RLS
-- ---------------------------------------------------------
alter table umsuka.event_comments enable row level security;
alter table umsuka.event_comments force row level security;

create policy "event_comments_select_authenticated"
  on umsuka.event_comments for select
  to authenticated
  using (umsuka.is_active_member());

create policy "event_comments_insert_own"
  on umsuka.event_comments for insert
  to authenticated
  with check (user_id = auth.uid());

-- The author can always delete their own comment; management can delete
-- any comment (moderation). No update policy: comments are immutable —
-- a mistake is handled by deletion.
create policy "event_comments_delete_own_or_management"
  on umsuka.event_comments for delete
  to authenticated
  using (user_id = auth.uid() or umsuka.is_management());