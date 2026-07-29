-- =========================================================
-- UMSUKA IMBALI APP — 0018: workgroup columns on profiles
-- =========================================================

alter table umsuka.profiles
  add column workgroup text not null default 'ninguno'
  check (workgroup in ('telas', 'barra', 'estandarte', 'limpieza', 'ninguno'));

alter table umsuka.profiles
  add column is_workgroup_lead boolean not null default false;

create index idx_profiles_workgroup on umsuka.profiles (workgroup);

comment on column umsuka.profiles.workgroup is
  'Workgroup assignment: telas, barra, estandarte, limpieza, or ninguno.';

comment on column umsuka.profiles.is_workgroup_lead is
  'True if the member is the designated lead of their assigned workgroup.';
