-- =========================================================
-- UMSUKA IMBALI APP — 0050: event audience
-- =========================================================
-- Sprint 18: audience segmentation for events. The creator can scope
-- an event to everyone ('all'), a single workgroup ('workgroup'), a
-- single member type / component ('member_type') or a concrete set of
-- users ('specific_users', backed by umsuka.event_audience_users).
--
-- Structure of this migration:
--   1. audience_type enum (idempotent) + comment.
--   2. events: audience_type / audience_workgroup / audience_member_type.
--   3. CHECK constraints keeping the columns coherent (audience_workgroup
--      only when audience_type = 'workgroup', etc.) + value whitelists.
--   4. Indexes + column comments.
--   5. umsuka.current_user_component() (SECURITY DEFINER, mirrors
--      current_user_workgroup()) so the SELECT policy can compare
--      member_type audiences against the viewer's component.
--   6. umsuka.event_audience_users (concrete users for specific_users).
--   7. RLS for event_audience_users: SELECT own row OR management OR
--      event creator; INSERT/UPDATE/DELETE management OR event creator.
--      The own-row SELECT clause is REQUIRED so the feed mirror can read
--      the viewer's rows through the authenticated client (D4).
--   8. events_select_authenticated rewritten to combine the existing
--      visible_to_group rule with the audience rule. Management always
--      sees everything; work_shift events keep audience_type='all' at
--      the application layer (D3), so the lead INSERT/UPDATE/DELETE
--      policies of Sprint 12 are untouched.

-- ---------------------------------------------------------
-- 1. audience_type enum
-- ---------------------------------------------------------
do $$ begin
  create type umsuka.audience_type as enum (
    'all', 'workgroup', 'member_type', 'specific_users'
  );
exception
  when duplicate_object then null;
end $$;

comment on type umsuka.audience_type is
  'Audience scope of an event: everyone, one workgroup, one member type (component) or a concrete set of users.';

-- ---------------------------------------------------------
-- 2. events columns
-- ---------------------------------------------------------
-- audience_workgroup / audience_member_type are TEXT (not the workgroup /
-- component enums) so the SELECT policy compares them directly with the
-- current_user_*() helpers without enum casts (D2).
alter table umsuka.events
  add column if not exists audience_type umsuka.audience_type not null default 'all';

alter table umsuka.events
  add column if not exists audience_workgroup text;

alter table umsuka.events
  add column if not exists audience_member_type text;

-- ---------------------------------------------------------
-- 3. CHECK constraints (no IF NOT EXISTS — pattern of 0044)
-- ---------------------------------------------------------
-- A value only makes sense when its audience type is active.
alter table umsuka.events
  add constraint chk_events_audience_workgroup_requires_type
  check (audience_workgroup is null or audience_type = 'workgroup');

alter table umsuka.events
  add constraint chk_events_audience_member_type_requires_type
  check (audience_member_type is null or audience_type = 'member_type');

-- Value whitelists (mirrors the client zod enums).
alter table umsuka.events
  add constraint chk_events_audience_workgroup_value
  check (audience_workgroup is null or audience_workgroup in ('telas','barra','estandarte','limpieza'));

alter table umsuka.events
  add constraint chk_events_audience_member_type_value
  check (audience_member_type is null or audience_member_type in ('music','dance','member'));

-- ---------------------------------------------------------
-- 4. Indexes + comments
-- ---------------------------------------------------------
create index if not exists idx_events_audience_type on umsuka.events (audience_type);
create index if not exists idx_events_audience_workgroup on umsuka.events (audience_workgroup);
create index if not exists idx_events_audience_member_type on umsuka.events (audience_member_type);

comment on column umsuka.events.audience_type is
  'How the event audience is scoped: all, one workgroup, one member type or a concrete user set.';
comment on column umsuka.events.audience_workgroup is
  'Target workgroup when audience_type = ''workgroup''. null otherwise.';
comment on column umsuka.events.audience_member_type is
  'Target member type (component) when audience_type = ''member_type''. null otherwise.';

-- ---------------------------------------------------------
-- 5. current_user_component()
-- ---------------------------------------------------------
create or replace function umsuka.current_user_component()
returns text
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select component_type from umsuka.profiles where id = auth.uid();
$$;

comment on function umsuka.current_user_component() is
  'Returns the component_type of the currently authenticated user.';

grant execute on function umsuka.current_user_component() to authenticated;

-- ---------------------------------------------------------
-- 6. event_audience_users
-- ---------------------------------------------------------
create table umsuka.event_audience_users (
    event_id uuid not null references umsuka.events(id)
        on delete cascade,
    user_id uuid not null references auth.users(id)
        on delete cascade,
    primary key (event_id, user_id)
);

comment on table umsuka.event_audience_users is
  'Concrete users an event with audience_type = specific_users is shown to.';

create index idx_event_audience_users_user_id on umsuka.event_audience_users (user_id);

-- ---------------------------------------------------------
-- 7. RLS — event_audience_users
-- ---------------------------------------------------------
alter table umsuka.event_audience_users enable row level security;
alter table umsuka.event_audience_users force row level security;

-- A member may read their own rows (so the feed mirror can ask "which
-- events am I in?" through the authenticated client), management reads
-- everything, and the event creator can inspect the configured audience.
create policy "event_audience_users_select_own_or_management_or_creator"
  on umsuka.event_audience_users for select
  to authenticated
  using (
    user_id = auth.uid()
    or umsuka.is_management()
    or exists (
      select 1 from umsuka.events e
      where e.id = event_id
        and e.created_by = auth.uid()
    )
  );

create policy "event_audience_users_insert_management_or_creator"
  on umsuka.event_audience_users for insert
  to authenticated
  with check (
    umsuka.is_management()
    or exists (
      select 1 from umsuka.events e
      where e.id = event_id
        and e.created_by = auth.uid()
    )
  );

create policy "event_audience_users_update_management_or_creator"
  on umsuka.event_audience_users for update
  to authenticated
  using (
    umsuka.is_management()
    or exists (
      select 1 from umsuka.events e
      where e.id = event_id
        and e.created_by = auth.uid()
    )
  )
  with check (
    umsuka.is_management()
    or exists (
      select 1 from umsuka.events e
      where e.id = event_id
        and e.created_by = auth.uid()
    )
  );

create policy "event_audience_users_delete_management_or_creator"
  on umsuka.event_audience_users for delete
  to authenticated
  using (
    umsuka.is_management()
    or exists (
      select 1 from umsuka.events e
      where e.id = event_id
        and e.created_by = auth.uid()
    )
  );

-- ---------------------------------------------------------
-- 8. events SELECT policy — audience visibility
-- ---------------------------------------------------------
-- An event is visible when the caller is management OR when BOTH the
-- legacy group rule (visible_to_group) AND the audience rule match.
-- The audience rule accepts: all, the caller's workgroup, the caller's
-- component, or membership in event_audience_users.
drop policy if exists "events_select_authenticated" on umsuka.events;
create policy "events_select_authenticated"
  on umsuka.events for select
  to authenticated
  using (
    umsuka.is_management()
    or (
      (
        visible_to_group is null
        or visible_to_group::text = umsuka.current_user_workgroup()::text
      )
      and (
        audience_type = 'all'
        or (audience_type = 'workgroup' and audience_workgroup = umsuka.current_user_workgroup()::text)
        or (audience_type = 'member_type' and audience_member_type = umsuka.current_user_component()::text)
        or exists (
          select 1 from umsuka.event_audience_users eau
          where eau.event_id = umsuka.events.id
            and eau.user_id = auth.uid()
        )
      )
    )
  );
