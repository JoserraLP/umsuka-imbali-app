-- =========================================================
-- UMSUKA IMBALI APP — 0052: notifications
-- =========================================================
-- Sprint 20: in-app notifications + realtime. Two new tables:
--   umsuka.notifications            — per-user notification rows.
--   umsuka.notification_preferences — per-user opt-out list (which
--                                     notification types they want).
--
-- Structure of this migration:
--   1. umsuka.notifications (PK, FK auth.users ON DELETE CASCADE,
--      CHECKs, indexes).
--   2. umsuka.notification_preferences (PK FK auth.users, types text[]).
--   3. Grants: service_role writes (the app's emit layer inserts rows on
--      behalf of other users via the privileged client).
--   4. RLS (enabled + forced) with 4 own-row policies per table, so the
--      authenticated role receives full CRUD of its own rows through the
--      default privileges granted by migration 0000.
--   5. handle_new_user() extended (CREATE OR REPLACE, additive): every
--      new auth.users row also gets a notification_preferences row, so
--      "absent preference" only happens for legacy accounts (treated as
--      "receive everything" by the emit layer).
--   6. Realtime: umsuka.notifications added to the supabase_realtime
--      publication so subscribed clients receive INSERT/UPDATE/DELETE
--      events for their own rows.

-- ---------------------------------------------------------
-- 1. umsuka.notifications
-- ---------------------------------------------------------
create table if not exists umsuka.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  message text,
  type text not null,
  is_read boolean not null default false,
  link text,
  created_at timestamptz not null default now()
);

alter table umsuka.notifications
  add constraint chk_notifications_title_length
  check (length(title) <= 200);

alter table umsuka.notifications
  add constraint chk_notifications_message_length
  check (message is null or length(message) <= 1000);

alter table umsuka.notifications
  add constraint chk_notifications_type
  check (type in ('event_created', 'news_created', 'voting_created', 'shift_assigned', 'profile_approved'));

alter table umsuka.notifications
  add constraint chk_notifications_link_length
  check (link is null or length(link) <= 2048);

create index if not exists idx_notifications_user_created
  on umsuka.notifications (user_id, created_at desc);

create index if not exists idx_notifications_user_unread
  on umsuka.notifications (user_id)
  where is_read = false;

-- ---------------------------------------------------------
-- 2. umsuka.notification_preferences
-- ---------------------------------------------------------
create table if not exists umsuka.notification_preferences (
  user_id uuid primary key references auth.users(id) on delete cascade,
  types text[] not null default '{}'
);

-- ---------------------------------------------------------
-- 3. Grants (service_role: privileged writes only)
-- ---------------------------------------------------------
-- SECURITY: the app-layer emit service (src/lib/notifications/emit.ts)
-- inserts notifications "on behalf of" other users, so it needs a
-- privileged role, NOT the authenticated client (whose RLS would reject
-- rows owned by other users). service_role receives only what that layer
-- needs: SELECT/INSERT on notifications and SELECT/INSERT/UPDATE on
-- notification_preferences (the filter query before every bulk emit).
-- The authenticated role already has full CRUD on both tables via the
-- default privileges from migration 0000, and RLS restricts it to its
-- own rows (policies below).
grant select, insert on umsuka.notifications to service_role;
grant select, insert, update on umsuka.notification_preferences to service_role;

-- ---------------------------------------------------------
-- 4. RLS (own-row, per table)
-- ---------------------------------------------------------
alter table umsuka.notifications enable row level security;
alter table umsuka.notifications force row level security;

create policy notifications_select_own
  on umsuka.notifications for select
  to authenticated
  using (user_id = auth.uid());

create policy notifications_insert_own
  on umsuka.notifications for insert
  to authenticated
  with check (user_id = auth.uid());

create policy notifications_update_own
  on umsuka.notifications for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy notifications_delete_own
  on umsuka.notifications for delete
  to authenticated
  using (user_id = auth.uid());

alter table umsuka.notification_preferences enable row level security;
alter table umsuka.notification_preferences force row level security;

create policy preferences_select_own
  on umsuka.notification_preferences for select
  to authenticated
  using (user_id = auth.uid());

create policy preferences_insert_own
  on umsuka.notification_preferences for insert
  to authenticated
  with check (user_id = auth.uid());

create policy preferences_update_own
  on umsuka.notification_preferences for update
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy preferences_delete_own
  on umsuka.notification_preferences for delete
  to authenticated
  using (user_id = auth.uid());

-- ---------------------------------------------------------
-- 5. handle_new_user() extension (additive CREATE OR REPLACE)
-- ---------------------------------------------------------
-- The existing trigger on_auth_user_created (migration 0012) is reused
-- unchanged; only the function body grows. A missing preferences row
-- means "receive everything" in the emit layer, so legacy accounts are
-- never silently excluded.
create or replace function umsuka.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = umsuka, public
as $$
declare
  v_full_name text;
  v_first_name text;
  v_last_name text;
begin
  v_full_name := trim(
    coalesce(
      new.raw_user_meta_data->>'full_name',
      new.raw_user_meta_data->>'name',
      ''
    )
  );

  v_first_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'given_name'), ''),
    nullif(split_part(v_full_name, ' ', 1), ''),
    'New'
  );

  v_last_name := coalesce(
    nullif(trim(new.raw_user_meta_data->>'family_name'), ''),
    nullif(trim(substring(v_full_name from length(split_part(v_full_name, ' ', 1)) + 1)), ''),
    'Member'
  );

  insert into umsuka.profiles (id, first_name, last_name, component_type, role)
  values (new.id, v_first_name, v_last_name, 'member', 'member')
  on conflict (id) do nothing;

  insert into umsuka.notification_preferences (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

comment on function umsuka.handle_new_user() is
  'Auto-provisions a umsuka.profiles row and a umsuka.notification_preferences row from Google OAuth metadata when a new auth.users row is created.';

-- ---------------------------------------------------------
-- 6. Realtime publication
-- ---------------------------------------------------------
-- SECURITY note (grants checked against the project defaults): the
-- realtime worker evaluates RLS as the role of the subscriber JWT
-- (authenticated). Our RLS own-row policies + the default privileges
-- granted to authenticated (migration 0000) fully cover the SELECT the
-- worker performs, so no extra grant is required. If a project's
-- supabase_realtime_admin role needs explicit SELECT for replication,
-- the fallback is:
--   grant select on umsuka.notifications to supabase_realtime_admin;
-- Replica identity stays the default (primary key), which is sufficient
-- for full-row change events; no REPLICA IDENTITY FULL is needed.
-- Re-executing this statement fails cleanly ("table is already member of
-- publication") — desired, same pattern as the CHECK constraints above.
alter publication supabase_realtime add table umsuka.notifications;

-- ---------------------------------------------------------
-- 7. Column comments (semantics)
-- ---------------------------------------------------------
comment on column umsuka.notifications.type is
  'Notification kind. One of: event_created (new event announced to its audience), news_created (published news), voting_created (new voting opened), shift_assigned (a shift was assigned to this user), profile_approved (this user''s account was approved). Drives the icon/color in the UI and the notification_preferences filter.';

comment on column umsuka.notifications.link is
  'In-app destination opened when the user clicks the notification (e.g. /events/<id>). null when there is no target page.';

comment on column umsuka.notifications.message is
  'Optional short context message (e.g. event title or shift description). null when the title alone is enough.';

comment on column umsuka.notification_preferences.types is
  '''{ }'' = receive every notification type (default). A non-empty array opts OUT of every type not listed. Values must match umsuka.notifications.type.';

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (no Supabase local/CLI in this environment; SQL is
-- hand-reasoned — pattern of ADR Sprint 19). Verify before deploy:
--
-- [ ] pg_policies shows exactly 8 new policies: notifications_select_own,
--       notifications_insert_own, notifications_update_own,
--       notifications_delete_own, preferences_select_own,
--       preferences_insert_own, preferences_update_own,
--       preferences_delete_own (all `to authenticated`).
-- [ ] pg_class.relrowsecurity = true AND relforcerowsecurity = true for
--       umsuka.notifications and umsuka.notification_preferences.
-- [ ] pg_publication_tables includes umsuka.notifications (publication
--       supabase_realtime).
-- [ ] An authenticated user can insert their own notification row and
--       update/delete it; inserting a row with user_id = another user
--       fails (policy with check).
-- [ ] handle_new_user(): a fresh auth.users insert produces BOTH a
--       profiles row and a notification_preferences row with types '{}'.
-- [ ] Deleting an auth.users row cascades: notifications and
--       notification_preferences rows disappear (FK on delete cascade).
-- [ ] service_role can select/insert notifications and select/insert/
--       update notification_preferences (emit layer); service_role
--       UPDATE on notifications is deliberately NOT granted (reads and
--       writes only — mark-as-read goes through the authenticated RLS
--       path).
-- [ ] CHECK constraints reject: title > 200 chars, message > 1000 chars,
--       link > 2048 chars, type outside the 5 allowed values.
-- [ ] supabase db push applies the migration (or npm run supabase:reset
--       locally); re-run fails cleanly on the duplicate CHECKs and the
--       duplicate publication membership.
-- ---------------------------------------------------------