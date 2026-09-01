-- =========================================================
-- UMSUKA IMBALI APP — 0075: año carnavalero marzo→febrero (Sprint 38 fix)
-- =========================================================
-- Cambia el año carnavalero de enero-diciembre a marzo→febrero:
--   Año 2026 = 2026-03-01 → 2027-02-28/29 (último día de febrero)
--   Año N    = N-03-01 → N+1-02-(28/29)
-- Ajusta el pendiente de pago anual de diciembre (12) a febrero (02).
--
-- Design:
--   1. Actualiza carnival_years existente: active 2026 pasa de 2026-01-01 a 2026-03-01.
--      Archived (si existen) se corrigen a marzo→febrero según su year.
--   2. Añade CHECKs que garantizan marzo en start_date y febrero en end_date
--      (end_date nullable mientras active). Usa NOT VALID para no bloquear datos legacy
--      que aún no cumplan, luego VALIDATE tras backfill.
--   3. Documenta que pagos anuales (period_year) cubren marzo→febrero del año carnavalero,
--      no enero→diciembre natural. El código JS (payments/queries, summary) se encarga
--      del mapeo getCarnivalYear(month>=3 ? year : year-1).
--   4. Idempotente (IF NOT EXISTS, ADD CONSTRAINT IF NOT EXISTS via DO).

-- ---------------------------------------------------------
-- 1. Backfill: corregir start_date de años existentes a 1 de marzo
-- ---------------------------------------------------------
do $$
declare
  r record;
  v_last_feb date;
begin
  for r in select id, year, start_date, end_date, status from umsuka.carnival_years loop
    -- start_date debe ser 1 de marzo del year
    if r.start_date is distinct from make_date(r.year, 3, 1) then
      update umsuka.carnival_years
        set start_date = make_date(r.year, 3, 1)
        where id = r.id;
    end if;

    -- Si está archivado y tiene end_date, debe ser último día de febrero de year+1
    if r.status = 'archived'::umsuka.carnival_year_status and r.end_date is not null then
      -- último día de febrero de year+1
      v_last_feb := (make_date(r.year + 1, 2, 1) + interval '1 month - 1 day')::date;
      if r.end_date is distinct from v_last_feb then
        update umsuka.carnival_years
          set end_date = v_last_feb
          where id = r.id;
      end if;
    end if;

    -- Si está activo, end_date debe ser NULL (se pondrá al archivar)
    if r.status = 'active'::umsuka.carnival_year_status and r.end_date is not null then
      update umsuka.carnival_years set end_date = null where id = r.id;
    end if;
  end loop;
end $$;

-- Si no existe ningún año activo, crear 2026 con marzo (idempotente con el backfill de 072)
do $$
declare
  v_exists boolean;
begin
  select exists(select 1 from umsuka.carnival_years where status='active'::umsuka.carnival_year_status) into v_exists;
  if not v_exists then
    insert into umsuka.carnival_years (year, label, start_date, status)
    values (2026, 'Carnaval 2026', make_date(2026, 3, 1), 'active'::umsuka.carnival_year_status)
    on conflict (year) do nothing;
  end if;
end $$;

-- ---------------------------------------------------------
-- 2. CHECKs: marzo para start_date, febrero para end_date
-- ---------------------------------------------------------
do $$
begin
  -- start_date debe ser 1 de marzo
  if not exists (select 1 from pg_constraint where conname='chk_carnival_years_start_march') then
    alter table umsuka.carnival_years
      add constraint chk_carnival_years_start_march
      check (extract(month from start_date) = 3 and extract(day from start_date) = 1)
      not valid;
  end if;

  -- end_date si no null debe ser febrero (28 o 29) de year+1
  if not exists (select 1 from pg_constraint where conname='chk_carnival_years_end_february') then
    alter table umsuka.carnival_years
      add constraint chk_carnival_years_end_february
      check (
        end_date is null
        or (
          extract(month from end_date) = 2
          and extract(day from end_date) in (28, 29)
          and extract(year from end_date) = year + 1
        )
      )
      not valid;
  end if;
end $$;

-- Validar tras backfill (si hay filas que aún no cumplen, VALIDATE la deja NOT VALID hasta corregir)
alter table umsuka.carnival_years validate constraint chk_carnival_years_start_march;
alter table umsuka.carnival_years validate constraint chk_carnival_years_end_february;

comment on constraint chk_carnival_years_start_march on umsuka.carnival_years is
  'Año carnavalero empieza el 1 de marzo (marzo→febrero, no enero→diciembre).';
comment on constraint chk_carnival_years_end_february on umsuka.carnival_years is
  'Año carnavalero termina el último día de febrero del año siguiente (28/29, año+1).';

-- Actualizar comentarios de columnas
comment on column umsuka.carnival_years.start_date is 'Fecha inicio del año de carnaval: siempre 1 de marzo (N-03-01).';
comment on column umsuka.carnival_years.end_date is 'Fecha cierre: último día de febrero de N+1 (28/29), NULL mientras active.';

-- ---------------------------------------------------------
-- MANUAL CHECKLIST
-- [ ] carnival_years con year 2026 tiene start_date 2026-03-01, end_date NULL si active
-- [ ] Años archivados tienen end_date = último día de febrero de year+1
-- [ ] CHECKs existen y están validados ( \d umsuka.carnival_years muestra chk_... )
-- [ ] Insertar nuevo año fuera de marzo/febrero falla CHECK (ej. 2027-01-01)
-- [ ] Pagos anuales period_year=N cubren marzo N → febrero N+1 (ver JS getCarnivalYear)
-- [ ] Pendiente anual ahora es febrero (02) no diciembre (12)
-- ---------------------------------------------------------
