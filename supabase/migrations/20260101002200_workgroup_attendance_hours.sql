-- =========================================================
-- UMSUKA IMBALI APP — 0023: workgroup attendance details
-- =========================================================
-- Adds hours_worked (for telas, estandarte, limpieza) and
-- barra_task (for barra: cocina or bebidas) columns so each
-- workgroup attendance record can store details about what
-- the member did and for how long.

alter table umsuka.workgroup_attendance
  add column hours_worked numeric(5,2)
  check (hours_worked is null or hours_worked > 0);

alter table umsuka.workgroup_attendance
  add column barra_task text
  check (barra_task is null or barra_task in ('cocina', 'bebidas'));

comment on column umsuka.workgroup_attendance.hours_worked is
  'Number of hours the member worked (for telas, estandarte, limpieza). NULL for barra.';

comment on column umsuka.workgroup_attendance.barra_task is
  'Barra-specific task: cocina (kitchen) or bebidas (drinks). NULL for non-barra workgroups.';
