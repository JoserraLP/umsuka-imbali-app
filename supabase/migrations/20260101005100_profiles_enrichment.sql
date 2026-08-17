-- =========================================================
-- UMSUKA IMBALI APP — 0051: profiles enrichment
-- =========================================================
-- Sprint 19: enriched member profiles. Adds avatar_url, bio, phone,
-- skills (text[]) and joined_at to umsuka.profiles so members can
-- publish a photo, biography, contact phone and skill tags, and record
-- when they joined the comparsa (semantically distinct from created_at,
-- which records when the account was created).
--
-- Structure of this migration:
--   1. New columns (add column if not exists).
--   2. CHECK constraints keeping values sane (length limits, phone
--      format, https-only avatar URLs, skills count, joined_at not in
--      the future).
--   3. Column comments documenting the semantics of each field
--      (in particular joined_at vs created_at).
--
-- RLS: deliberately untouched. The existing
-- "profiles_update_own_or_admin" policy is column-agnostic, so the new
-- editable fields are protected by the same rules as the existing ones
-- (own row for members, any row for admin/super_admin).

-- ---------------------------------------------------------
-- 1. New columns
-- ---------------------------------------------------------
alter table umsuka.profiles
  add column if not exists avatar_url text;

alter table umsuka.profiles
  add column if not exists bio text;

alter table umsuka.profiles
  add column if not exists phone text;

alter table umsuka.profiles
  add column if not exists skills text[] not null default '{}';

alter table umsuka.profiles
  add column if not exists joined_at date;

-- ---------------------------------------------------------
-- 2. CHECK constraints (no IF NOT EXISTS — pattern of 0050)
-- ---------------------------------------------------------
alter table umsuka.profiles
  add constraint chk_profiles_bio_length
  check (bio is null or length(bio) <= 500);

alter table umsuka.profiles
  add constraint chk_profiles_phone_format
  check (phone is null or phone ~ '^[+0-9 ()-]{6,20}$');

alter table umsuka.profiles
  add constraint chk_profiles_avatar_url_length
  check (avatar_url is null or length(avatar_url) <= 2048);

alter table umsuka.profiles
  add constraint chk_profiles_avatar_url_https
  check (avatar_url is null or avatar_url ~ '^https://');

alter table umsuka.profiles
  add constraint chk_profiles_skills_count
  check (array_length(skills, 1) is null or array_length(skills, 1) <= 10);

alter table umsuka.profiles
  add constraint chk_profiles_joined_at_not_future
  check (joined_at is null or joined_at <= current_date);

-- ---------------------------------------------------------
-- 3. Column comments
-- ---------------------------------------------------------
comment on column umsuka.profiles.avatar_url is
  'External HTTPS URL of the member''s profile photo (allowlisted hosts mirror the app CSP). null when unset.';

comment on column umsuka.profiles.bio is
  'Short self-description shown on the profile page. null when unset.';

comment on column umsuka.profiles.phone is
  'Contact phone number (digits, spaces, parentheses, dashes, optional leading +). null when unset.';

comment on column umsuka.profiles.skills is
  'Free-form skill tags shown as chips on the profile page. Normalized (trimmed, case-insensitive dedupe), max 10 items.';

comment on column umsuka.profiles.joined_at is
  'Date the member joined the comparsa, editable by the member themselves. Distinct from created_at (account creation timestamp, read-only). null when unset.';