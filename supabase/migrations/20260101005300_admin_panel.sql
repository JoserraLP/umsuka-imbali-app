-- =========================================================
-- UMSUKA IMBALI APP — 0053: admin panel
-- =========================================================
-- Sprint 21: admin control panel. Three new tables:
--   umsuka.settings         — global app configuration (key/value).
--   umsuka.audit_logs       — append-only log of every administrative
--                             action (role changes, alta/baja, approvals,
--                             settings updates, password resets, ...).
--   umsuka.role_permissions — granular permission mapping per role;
--                             seeded below and mirrored in TS
--                             (src/lib/admin/permissions.ts) — the seed is
--                             the source of truth for the DB, the TS map
--                             is kept in sync by a unit test.
--
-- Structure of this migration:
--   1. umsuka.settings (PK key, FK auth.users ON DELETE SET NULL,
--      CHECKs, seed).
--   2. umsuka.audit_logs (PK id, FK auth.users ON DELETE SET NULL,
--      CHECKs for the 13 audit actions, 4 indexes).
--   3. umsuka.role_permissions (composite PK, CHECKs, seed).
--   4. RLS (enabled + forced) on all three tables. The admin writes go
--      through the authenticated client: settings has SELECT/INSERT/
--      UPDATE for admins and DELETE for super_admin only (needed for the
--      app-layer upsert); audit_logs is SELECT/INSERT ONLY — append-only,
--      no UPDATE/DELETE policies even for super_admin (D5).
--   5. umsuka.get_user_emails(uuid[]) — SECURITY DEFINER helper that
--      resolves auth.users emails for the admin users table, masking the
--      internal aliases (@umsuka.internal → null) so they are never
--      exposed.
--   6. Column comments (semantics) + manual checklist.

-- ---------------------------------------------------------
-- 1. umsuka.settings
-- ---------------------------------------------------------
create table if not exists umsuka.settings (
  key text primary key,
  value text not null,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table umsuka.settings
  add constraint chk_settings_key_length
  check (length(key) <= 100);

alter table umsuka.settings
  add constraint chk_settings_value_length
  check (length(value) <= 500);

-- ---------------------------------------------------------
-- 2. umsuka.audit_logs (append-only)
-- ---------------------------------------------------------
create table if not exists umsuka.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb,
  created_at timestamptz not null default now()
);

alter table umsuka.audit_logs
  add constraint chk_audit_logs_action
  check (action in (
    'user.role_changed',
    'user.activated',
    'user.deactivated',
    'user.approved',
    'user.suspended',
    'user.profile_updated',
    'user.component_type_changed',
    'user.workgroup_changed',
    'user.component_lead_changed',
    'user.emailless_created',
    'user.password_reset_generated',
    'user.account_unlocked',
    'settings.updated'
  ));

alter table umsuka.audit_logs
  add constraint chk_audit_logs_entity_type
  check (length(entity_type) <= 100);

alter table umsuka.audit_logs
  add constraint chk_audit_logs_entity_id
  check (entity_id is null or length(entity_id) <= 200);

create index if not exists idx_audit_logs_user_created
  on umsuka.audit_logs (user_id, created_at desc);

create index if not exists idx_audit_logs_action_created
  on umsuka.audit_logs (action, created_at desc);

create index if not exists idx_audit_logs_created
  on umsuka.audit_logs (created_at desc);

create index if not exists idx_audit_logs_entity
  on umsuka.audit_logs (entity_type, entity_id);

-- ---------------------------------------------------------
-- 3. umsuka.role_permissions (granular permissions)
-- ---------------------------------------------------------
create table if not exists umsuka.role_permissions (
  role text not null,
  permission text not null,
  primary key (role, permission)
);

alter table umsuka.role_permissions
  add constraint chk_role_permissions_role
  check (role in ('super_admin', 'admin', 'board_member', 'event_manager', 'member', 'guest'));

alter table umsuka.role_permissions
  add constraint chk_role_permissions_permission
  check (permission in ('users.read', 'users.manage', 'settings.read', 'settings.write', 'audit.read'));

-- ---------------------------------------------------------
-- Seeds
-- ---------------------------------------------------------
-- role_permissions: super_admin and admin get all five permissions;
-- board_member and event_manager can only read the member directory
-- (same set as isManagementRole); member/guest have no rows.
insert into umsuka.role_permissions (role, permission)
values
  ('super_admin', 'users.read'),
  ('super_admin', 'users.manage'),
  ('super_admin', 'settings.read'),
  ('super_admin', 'settings.write'),
  ('super_admin', 'audit.read'),
  ('admin', 'users.read'),
  ('admin', 'users.manage'),
  ('admin', 'settings.read'),
  ('admin', 'settings.write'),
  ('admin', 'audit.read'),
  ('board_member', 'users.read'),
  ('event_manager', 'users.read')
on conflict do nothing;

-- settings: app defaults (upsert-safe seed).
insert into umsuka.settings (key, value)
values
  ('app_name', 'Umsuka Imbali'),
  ('instagram_url', 'https://instagram.com/umsukaimbali')
on conflict (key) do nothing;

-- ---------------------------------------------------------
-- 4. RLS (enabled + forced, per table)
-- ---------------------------------------------------------
-- SECURITY: this sprint writes with the authenticated admin client
-- (src/lib/admin/{queries,mutations}.ts use createClient(), not the
-- service-role client), so the admin policies below are the write path
-- AND the RLS backstop. service_role receives NO grants on these tables:
-- nothing in this sprint needs privileged writes, and the audit trail
-- must stay admin-scoped (D5).
alter table umsuka.settings enable row level security;
alter table umsuka.settings force row level security;

create policy settings_select_admin
  on umsuka.settings for select
  to authenticated
  using (umsuka.is_admin());

create policy settings_insert_admin
  on umsuka.settings for insert
  to authenticated
  with check (umsuka.is_admin());

create policy settings_update_admin
  on umsuka.settings for update
  to authenticated
  using (umsuka.is_admin())
  with check (umsuka.is_admin());

-- D6: DELETE stays super_admin-only (the app-layer upsert never deletes,
-- but a future cleanup path must not be available to a plain admin).
create policy settings_delete_super_admin
  on umsuka.settings for delete
  to authenticated
  using (umsuka.is_super_admin());

alter table umsuka.audit_logs enable row level security;
alter table umsuka.audit_logs force row level security;

create policy audit_logs_select_admin
  on umsuka.audit_logs for select
  to authenticated
  using (umsuka.is_admin());

-- Append-only (D5): INSERT requires the actor to be admin AND the row's
-- user_id to be the caller — an actor can only ever log their own
-- actions; there are NO update/delete policies (not even super_admin).
create policy audit_logs_insert_admin
  on umsuka.audit_logs for insert
  to authenticated
  with check (umsuka.is_admin() and user_id = auth.uid());

alter table umsuka.role_permissions enable row level security;
alter table umsuka.role_permissions force row level security;

create policy role_permissions_select_active
  on umsuka.role_permissions for select
  to authenticated
  using (umsuka.is_active_member());

-- ---------------------------------------------------------
-- 5. get_user_emails(uuid[]) — masked email resolution for the admin
--    users table (SECURITY DEFINER)
-- ---------------------------------------------------------
-- SECURITY: runs with the function owner's privileges to read
-- auth.users, but first re-checks that the caller is an admin
-- (umsuka.is_admin(), fail-closed: any other role gets 'forbidden').
-- Aliases are NEVER exposed: any email ending in @umsuka.internal
-- resolves to null. Grant is limited to the authenticated role — the
-- service_role client has no need for this helper.
create or replace function umsuka.get_user_emails(p_user_ids uuid[])
returns table (id uuid, email text)
language plpgsql
stable
security definer
set search_path = umsuka, public
as $$
begin
  if not umsuka.is_admin() then
    raise exception 'forbidden';
  end if;

  return query
    select u.id,
           case
             when u.email like '%@umsuka.internal' then null
             else u.email
           end as email
    from auth.users u
    where u.id = any(p_user_ids);
end;
$$;

comment on function umsuka.get_user_emails(uuid[]) is
  'Resolves the auth.users emails of the given ids for admin-only callers (re-checks umsuka.is_admin(), raises ''forbidden'' otherwise). Internal email aliases (@umsuka.internal) are masked as null and must never be exposed in the UI.';

grant execute on function umsuka.get_user_emails(uuid[]) to authenticated;

-- Hardening: PostgreSQL grants EXECUTE to PUBLIC by default; revoke it so
-- only the explicit grant above (authenticated) survives. The function
-- re-checks umsuka.is_admin() regardless (fail-closed), this is defense
-- in depth.
revoke execute on function umsuka.get_user_emails(uuid[]) from public;

-- ---------------------------------------------------------
-- 6. Column comments (semantics)
-- ---------------------------------------------------------
comment on table umsuka.settings is
  'Global application settings (key/value). updated_by/updated_at track the last administrator that changed the value.';

comment on column umsuka.settings.key is
  'Setting identifier (e.g. app_name, instagram_url). Known keys are enforced in the app layer (src/lib/admin/schema.ts).';

comment on column umsuka.settings.value is
  'Setting value, free text (max 500 chars). The app layer enforces a stricter 300-char cap.';

comment on column umsuka.settings.updated_by is
  'auth.users id of the administrator that last updated the value. null when the row was seeded or its author was deleted.';

comment on table umsuka.audit_logs is
  'Append-only administrative audit trail. Rows are never updated or deleted (RLS has no UPDATE/DELETE policies); the app layer only inserts through the authenticated admin client.';

comment on column umsuka.audit_logs.action is
  'One of the 13 audited administrative actions: user.role_changed, user.activated, user.deactivated, user.approved, user.suspended, user.profile_updated, user.component_type_changed, user.workgroup_changed, user.component_lead_changed, user.emailless_created, user.password_reset_generated, user.account_unlocked, settings.updated.';

comment on column umsuka.audit_logs.entity_type is
  'Kind of the affected entity (e.g. profile, settings). Free text, max 100 chars.';

comment on column umsuka.audit_logs.entity_id is
  'Identifier of the affected entity (e.g. the profile id, the settings key). null when no single entity applies.';

comment on column umsuka.audit_logs.details is
  'Free-form JSON context of the action (e.g. {fromRole, toRole} for role changes). null when no context is needed.';

comment on table umsuka.role_permissions is
  'Granular permission mapping per role. Seeded by this migration and mirrored in src/lib/admin/permissions.ts; a unit test keeps both in sync.';

comment on column umsuka.role_permissions.role is
  'Application role (super_admin, admin, board_member, event_manager, member, guest).';

comment on column umsuka.role_permissions.permission is
  'Granular permission: users.read, users.manage, settings.read, settings.write, audit.read.';

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (no Supabase local/CLI in this environment; SQL is
-- hand-reasoned — pattern of the previous sprints). Verify before deploy:
--
-- [ ] pg_policies shows exactly 7 new policies: settings_select_admin,
--       settings_insert_admin, settings_update_admin,
--       settings_delete_super_admin, audit_logs_select_admin,
--       audit_logs_insert_admin, role_permissions_select_active
--       (all `to authenticated`).
-- [ ] pg_class.relrowsecurity = true AND relforcerowsecurity = true for
--       umsuka.settings, umsuka.audit_logs and umsuka.role_permissions.
-- [ ] role_permissions seeds: 5 rows for super_admin, 5 for admin,
--       1 (users.read) for board_member, 1 for event_manager, none for
--       member/guest.
-- [ ] settings seeds: app_name='Umsuka Imbali', instagram_url=
--       'https://instagram.com/umsukaimbali'.
-- [ ] An admin can SELECT/INSERT/UPDATE settings and SELECT/INSERT
--       audit_logs (with user_id = auth.uid()); UPDATE/DELETE on
--       audit_logs fails for EVERY role including super_admin
--       (append-only); DELETE on settings fails for a plain admin.
-- [ ] A non-admin (member) gets zero rows/zero inserts on all three
--       tables; role_permissions is readable by every active member.
-- [ ] SELECT umsuka.get_user_emails(...) as an admin returns emails with
--       @umsuka.internal aliases masked as null; as a non-admin raises
--       'forbidden'.
-- [ ] CHECK constraints reject: settings key > 100 chars, value > 500,
--       audit action outside the 13 values, entity_type > 100, entity_id
--       > 200 (null allowed), role_permissions role/permission outside
--       the allowed sets.
-- [ ] supabase db push applies the migration (or npm run supabase:reset
--       locally); re-run fails cleanly on the duplicate CHECKs.
-- ---------------------------------------------------------