-- =========================================================
-- UMSUKA IMBALI APP — 0039: questions RLS & enhancement
-- =========================================================
-- Adds category/priority columns, creates question_comments
-- table, enables RLS with granular policies.
-- =========================================================

-- 1. Add columns to existing questions table
alter table umsuka.questions
  add column category text,
  add column priority text;

comment on column umsuka.questions.category is 'Category label (general, ensayo, evento, vestuario, musica, otro)';
comment on column umsuka.questions.priority is 'Priority level (baja, media, alta)';

create index idx_questions_category on umsuka.questions (category);
create index idx_questions_priority on umsuka.questions (priority);

-- 2. Create question_comments table
create table umsuka.question_comments (
    id uuid default gen_random_uuid() primary key,
    question_id uuid not null references umsuka.questions(id) on delete cascade,
    user_id uuid not null references auth.users(id),
    content text not null,
    created_at timestamptz default now()
);

comment on table umsuka.question_comments is 'Comments/discussion on questions.';

create index idx_question_comments_question_id on umsuka.question_comments (question_id);

-- 3. Enable RLS
alter table umsuka.questions enable row level security;
alter table umsuka.question_comments enable row level security;

-- 4. RLS policies for questions
create policy "any_auth_user_can_select_questions"
  on umsuka.questions for select
  using (auth.role() = 'authenticated');

create policy "any_auth_user_can_insert_questions"
  on umsuka.questions for insert
  with check (auth.role() = 'authenticated');

create policy "creator_or_management_can_update_questions"
  on umsuka.questions for update
  using (
    auth.uid() = user_id
    or (select role from umsuka.profiles where id = auth.uid()) = any (array['super_admin','admin','board_member','event_manager'])
  );

create policy "creator_or_management_can_delete_questions"
  on umsuka.questions for delete
  using (
    auth.uid() = user_id
    or (select role from umsuka.profiles where id = auth.uid()) = any (array['super_admin','admin','board_member','event_manager'])
  );

-- 5. RLS policies for question_comments
create policy "any_auth_user_can_select_comments"
  on umsuka.question_comments for select
  using (auth.role() = 'authenticated');

create policy "any_auth_user_can_insert_comments"
  on umsuka.question_comments for insert
  with check (auth.role() = 'authenticated');

create policy "creator_can_update_comment"
  on umsuka.question_comments for update
  using (auth.uid() = user_id);

create policy "creator_or_management_can_delete_comments"
  on umsuka.question_comments for delete
  using (
    auth.uid() = user_id
    or (select role from umsuka.profiles where id = auth.uid()) = any (array['super_admin','admin','board_member','event_manager'])
  );
