-- =========================================================
-- UMSUKA IMBALI APP — 0021: workgroup ENUM type
-- =========================================================
-- Replaces the CHECK constraint on umsuka.profiles.workgroup
-- and the free-text column on umsuka.workgroup_attendance with
-- a proper PostgreSQL ENUM for stronger type safety.

do $$ begin
  create type umsuka.workgroup as enum (
    'telas', 'barra', 'estandarte', 'limpieza', 'ninguno'
  );
exception
  when duplicate_object then null;
end $$;

comment on type umsuka.workgroup is
  'Workgroup assignment: telas, barra, estandarte, limpieza, or ninguno (unassigned).';

-- ---------------------------------------------------------
-- Migrate umsuka.profiles.workgroup
-- ---------------------------------------------------------
alter table umsuka.profiles
  drop constraint if exists profiles_workgroup_check;

alter table umsuka.profiles
  alter column workgroup type umsuka.workgroup
  using workgroup::umsuka.workgroup;

alter table umsuka.profiles
  alter column workgroup set default 'ninguno'::umsuka.workgroup;

-- ---------------------------------------------------------
-- Migrate umsuka.workgroup_attendance.workgroup
-- The unique constraint (shift_id, user_id, workgroup) will
-- be automatically re-checked after the type change.
-- ---------------------------------------------------------
alter table umsuka.workgroup_attendance
  alter column workgroup type umsuka.workgroup
  using workgroup::umsuka.workgroup;
