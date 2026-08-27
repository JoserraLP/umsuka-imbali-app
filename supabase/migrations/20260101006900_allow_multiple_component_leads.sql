-- =========================================================
-- UMSUKA IMBALI APP — 0069: allow multiple component leads (Sprint 33 fix)
-- =========================================================
-- Sprint 33 requiere varios responsables de baile/música simultáneos.
-- La migración 0043 imponía UNIQUE parcial en component_lead_for
-- (un solo lead por componente). Se reemplaza por índice no-único
-- para permitir N leads por componente, manteniendo el CHECK
-- component_lead_for IN ('music','dance') y la RLS is_component_lead().
--

-- Drop unique index if exists (from 0043)
drop index if exists umsuka.idx_profiles_component_lead_for;

-- Create non-unique partial index for lookups (no uniqueness)
create index if not exists idx_profiles_component_lead_for
  on umsuka.profiles (component_lead_for)
  where component_lead_for is not null;

comment on index umsuka.idx_profiles_component_lead_for is
  'Índice parcial para búsquedas de responsables por componente (permite múltiples leads por componente desde Sprint 33).';

-- Ensure CHECK still enforces music/dance only (from 0043, no change)
-- No RLS change: is_component_lead() ya soporta múltiples filas (coalesce ANY)
-- La UI /admin/users ya permite designar varios sin error 23505

-- MANUAL CHECKLIST
-- [ ] \d umsuka.profiles muestra component_lead_for text con CHECK music/dance
-- [ ] \di idx_profiles_component_lead_for muestra índice NO único ( indisunique = f )
-- [ ] INSERT dos usuarios con component_lead_for='dance' => OK (antes 23505)
-- [ ] INSERT dos usuarios con component_lead_for='music' => OK
-- [ ] is_component_lead('dance') true para cada lead dance, false para miembro normal
-- [ ] Re-run migration idempotente (DROP IF EXISTS + CREATE IF NOT EXISTS)
