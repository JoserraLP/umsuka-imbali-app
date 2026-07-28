-- =========================================================
-- UMSUKA IMBALI APP — 0015: profile activation status
-- =========================================================
-- BREAKING-CHANGE NOTE (non-breaking, additive):
-- Adds is_active to umsuka.profiles so admins can deactivate ("dar de
-- baja") a member without deleting their row — historical references
-- from future modules (attendance, shifts, votes, etc.) must survive a
-- deactivation. Defaults to true, so every existing row is unaffected.

alter table umsuka.profiles
  add column is_active boolean not null default true;

comment on column umsuka.profiles.is_active is
  'False means the member has been deactivated by an admin. Treated as logged out at the application layer regardless of having a valid auth session.';

create index idx_profiles_is_active on umsuka.profiles (is_active);
