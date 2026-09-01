-- =========================================================
-- UMSUKA IMBALI APP — 0074: legal_guardians service_role grants (fix)
-- =========================================================
-- Import masivo con --pending-gmail / guardian compartido fallaba con:
--   permission denied for table legal_guardians
-- Causa: RLS ENABLE+FORCE + policies is_management() para authenticated,
-- pero sin GRANT explícito a service_role. service_role bypassa RLS pero
-- sigue necesitando privilegio de tabla. Añadimos GRANT ALL a service_role
-- y authenticated (policies ya filtran) + uso de esquema.
-- También re-aseguramos grants de secuencias si existieran (id uuid gen_random_uuid() no usa secuencia,
-- pero por si se añade serial en el futuro).

grant usage on schema umsuka to service_role;
grant usage on schema umsuka to authenticated;

grant all on table umsuka.legal_guardians to service_role;
grant all on table umsuka.legal_guardians to authenticated;

-- Por si la PK usa secuencia (no en este caso, pero idempotente)
do $$
begin
  if exists (select 1 from pg_class where relname = 'legal_guardians_id_seq') then
    grant all on sequence umsuka.legal_guardians_id_seq to service_role;
    grant all on sequence umsuka.legal_guardians_id_seq to authenticated;
  end if;
end $$;

comment on table umsuka.legal_guardians is
  'Representantes legales — grants fix 0074: service_role + authenticated con RLS is_management()';
