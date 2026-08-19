-- =========================================================
-- UMSUKA IMBALI APP — 0054: permanent account deletion
-- =========================================================
-- Sprint 22: the super admin can permanently delete an account
-- (auth user + profile + related data). Strategy:
--
--   1. umsuka.profiles gains `deleted_at` (timestamptz, nullable).
--      The deletion service soft-deletes the profile FIRST (safeguard):
--      the account disappears from the app immediately (RLS functions
--      below exclude it) and, should the final auth deleteUser() fail,
--      the account stays disabled instead of half-deleted.
--   2. Every FK that references auth.users / umsuka.profiles with the
--      default NO ACTION is converted to ON DELETE SET NULL so the
--      physical deletion can never be blocked by orphaned rows. Tables
--      that already cascade or set null (attendance, absences,
--      shift_assignments, event_registrations, event_waitlist,
--      event_audience_users, event_comments, notifications,
--      workgroup_attendance.user_id, settings, audit_logs, email_aliases
--      profile_id, password_attempts, password_reset_tokens profile_id)
--      are left untouched.
--   3. service_role gains DELETE on password_reset_tokens (migration 0035
--      only granted insert/select/update): the deletion service purges
--      tokens through the service-role client and would otherwise hit a
--      permission-denied (42501) that blocks the physical deletion.
--   4. umsuka.is_active_member() and the profiles SELECT policy now also
--      exclude soft-deleted profiles (deleted_at IS NULL).
--   5. chk_audit_logs_action accepts the new 'user.deleted' action
--      (the audited set grows from 13 to 14 values).
--
-- NOT touched (by design): the profiles UPDATE/DELETE policies — the
-- deletion service writes through the service-role client (bypasses RLS),
-- and loosening/duplicating those policies would widen the authenticated
-- attack surface for no benefit.

-- ---------------------------------------------------------
-- 1. profiles.deleted_at (soft-delete safeguard)
-- ---------------------------------------------------------
alter table umsuka.profiles
  add column if not exists deleted_at timestamptz;

comment on column umsuka.profiles.deleted_at is
  'Soft-delete timestamp set by the account-deletion service before the physical auth.users deletion. null = the profile is live. Profiles with deleted_at are excluded from every read path (is_active_member() + profiles SELECT policy + app-layer queries).';

-- ---------------------------------------------------------
-- 2. FK cleanup (NO ACTION -> ON DELETE SET NULL)
-- ---------------------------------------------------------
-- Constraint names follow the Postgres default <table>_<column>_fkey,
-- verified against the DDL in the listed migrations.

-- events.created_by (20260101000200)
alter table umsuka.events
  drop constraint if exists events_created_by_fkey;

alter table umsuka.events
  add constraint events_created_by_fkey
    foreign key (created_by) references auth.users(id)
    on delete set null;

-- news.created_by (20260101000700)
alter table umsuka.news
  drop constraint if exists news_created_by_fkey;

alter table umsuka.news
  add constraint news_created_by_fkey
    foreign key (created_by) references auth.users(id)
    on delete set null;

-- questions.user_id (20260101000800)
alter table umsuka.questions
  drop constraint if exists questions_user_id_fkey;

alter table umsuka.questions
  add constraint questions_user_id_fkey
    foreign key (user_id) references auth.users(id)
    on delete set null;

-- question_comments.user_id (20260101003900) — NOT NULL + NO ACTION:
--   both the nullability and the FK action must change.
alter table umsuka.question_comments
  drop constraint if exists question_comments_user_id_fkey;

alter table umsuka.question_comments
  alter column user_id drop not null;

alter table umsuka.question_comments
  add constraint question_comments_user_id_fkey
    foreign key (user_id) references auth.users(id)
    on delete set null;

-- workgroup_attendance.marked_by (20260101001800); user_id already
-- cascades.
alter table umsuka.workgroup_attendance
  drop constraint if exists workgroup_attendance_marked_by_fkey;

alter table umsuka.workgroup_attendance
  add constraint workgroup_attendance_marked_by_fkey
    foreign key (marked_by) references auth.users(id)
    on delete set null;

-- email_aliases.created_by (20260101002800) — references
-- umsuka.profiles(id): when the profile row is removed by the auth.users
-- cascade, the alias audit trail is preserved with a null author.
alter table umsuka.email_aliases
  drop constraint if exists email_aliases_created_by_fkey;

alter table umsuka.email_aliases
  add constraint email_aliases_created_by_fkey
    foreign key (created_by) references umsuka.profiles(id)
    on delete set null;

-- ---------------------------------------------------------
-- 3. service_role DELETE on password_reset_tokens
-- ---------------------------------------------------------
-- Migration 0035 granted insert/select/update only; the deletion
-- service purges tokens created by the target through the service-role
-- client (admin.from("password_reset_tokens").delete().eq("created_by",
-- ...)) so DELETE must be granted too — otherwise step 6 (token purge)
-- fails with permission denied (42501) and the physical deletion never
-- completes.
grant delete on umsuka.password_reset_tokens to service_role;

-- ---------------------------------------------------------
-- 4. Read-path exclusion of soft-deleted profiles
-- ---------------------------------------------------------
create or replace function umsuka.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select coalesce(
    (select status = 'active' and is_active = true and deleted_at is null
     from umsuka.profiles
     where id = auth.uid()),
    false
  );
$$;

comment on function umsuka.is_active_member() is
  'True if the current user has status = active, is_active = true and deleted_at is null.';

grant execute on function umsuka.is_active_member() to authenticated;

drop policy if exists "profiles_select_authenticated" on umsuka.profiles;

create policy "profiles_select_authenticated"
  on umsuka.profiles for select
  to authenticated
  using (deleted_at is null and (umsuka.is_active_member() or id = auth.uid()));

-- ---------------------------------------------------------
-- 5. Audit actions: 13 -> 14 (add user.deleted)
-- ---------------------------------------------------------
alter table umsuka.audit_logs
  drop constraint if exists chk_audit_logs_action;

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
    'settings.updated',
    'user.deleted'
  ));

comment on column umsuka.audit_logs.action is
  'One of the 14 audited administrative actions: user.role_changed, user.activated, user.deactivated, user.approved, user.suspended, user.profile_updated, user.component_type_changed, user.workgroup_changed, user.component_lead_changed, user.emailless_created, user.password_reset_generated, user.account_unlocked, settings.updated, user.deleted.';

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (no Supabase local/CLI in this environment; SQL is
-- hand-reasoned — pattern of the previous sprints). Verify before deploy:
--
-- [ ] umsuka.profiles has a nullable deleted_at timestamptz column.
-- [ ] pg_constraint shows ON DELETE SET NULL on: events_created_by_fkey,
--       news_created_by_fkey, questions_user_id_fkey,
--       question_comments_user_id_fkey, workgroup_attendance_marked_by_fkey,
--       email_aliases_created_by_fkey; question_comments.user_id is now
--       nullable.
-- [ ] umsuka.is_active_member() includes deleted_at is null; a soft-deleted
--       profile returns false.
-- [ ] profiles_select_authenticated excludes soft-deleted profiles; a
--       soft-deleted user cannot read their own row either.
-- [ ] A super admin can update a profile with deleted_at set via the
--       service-role client (RLS bypass); the authenticated UPDATE policy
--       is untouched (own-or-admin, as before).
-- [ ] chk_audit_logs_action accepts all 14 actions and rejects any other
--       value; inserting action='user.deleted' succeeds.
-- [ ] The service_role role holds DELETE on umsuka.password_reset_tokens
--       (grant in section 3); the unauthenticated/unauthorized paths and
--       every infra step of deleteAccountPermanently() return typed
--       errors instead of throwing.
-- [ ] Deleting an auth user who has events/news/questions/comments/
--       workgroup-attendance (as marker)/email-alias rows succeeds (FKs
--       set null) and fails cleanly for rows that still reference the
--       profile (password_reset_tokens.created_by is purged by the
--       service before the delete).
-- [ ] supabase db push applies the migration; re-run fails cleanly on the
--       duplicate constraint names (drop constraint if exists softens it).
-- ---------------------------------------------------------