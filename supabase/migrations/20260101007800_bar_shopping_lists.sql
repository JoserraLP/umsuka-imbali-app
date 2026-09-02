-- =========================================================
-- UMSUKA IMBALI APP — 0078: bar shopping checklist (Sprint 16)
-- =========================================================
-- bar_shopping_lists, bar_shopping_items, ENUM status, RLS privado responsable de barra.
-- Idempotente: IF NOT EXISTS, DROP POLICY IF EXISTS.
--
-- Design decisions:
--   1. ENUM bar_shopping_status open/closed con guard.
--   2. bar_shopping_lists: title, status default open, created_by, closed_at CHECK coherencia.
--   3. bar_shopping_items: shopping_list_id CASCADE, bar_item_id nullable SET NULL, name, quantity_needed >0, etc.
--   4. Índices por list, bar_item, is_checked.
--   5. RLS enable+force: FOR ALL solo is_workgroup_lead('barra') OR is_super_admin() en ambas tablas.
--   6. Grants authenticated SELECT/INSERT/UPDATE/DELETE, service_role ALL.

-- ---------------------------------------------------------
-- 1. ENUM bar_shopping_status
-- ---------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE umsuka.bar_shopping_status AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE umsuka.bar_shopping_status IS 'Estado de lista de compra de barra: open (abierta), closed (cerrada).';

-- ---------------------------------------------------------
-- 2. Tabla bar_shopping_lists
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS umsuka.bar_shopping_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200 AND length(trim(title)) > 0),
  status umsuka.bar_shopping_status NOT NULL DEFAULT 'open',
  created_by uuid REFERENCES umsuka.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  closed_at timestamptz CHECK (closed_at IS NULL OR status = 'closed')
);
CREATE INDEX IF NOT EXISTS idx_bar_shopping_lists_status ON umsuka.bar_shopping_lists (status);
CREATE INDEX IF NOT EXISTS idx_bar_shopping_lists_created_by ON umsuka.bar_shopping_lists (created_by);
CREATE INDEX IF NOT EXISTS idx_bar_shopping_lists_created_at ON umsuka.bar_shopping_lists (created_at DESC);

COMMENT ON TABLE umsuka.bar_shopping_lists IS 'Listas de la compra de barra. Solo responsable de barra y super_admin (RLS). status open/closed. closed_at se setea al cerrar.';
COMMENT ON COLUMN umsuka.bar_shopping_lists.closed_at IS 'Instante de cierre, solo si status=closed.';

-- ---------------------------------------------------------
-- 3. Tabla bar_shopping_items
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS umsuka.bar_shopping_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopping_list_id uuid NOT NULL REFERENCES umsuka.bar_shopping_lists(id) ON DELETE CASCADE,
  bar_item_id uuid REFERENCES umsuka.bar_items(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200 AND length(trim(name)) > 0),
  quantity_needed int NOT NULL CHECK (quantity_needed > 0),
  quantity_purchased int NOT NULL DEFAULT 0 CHECK (quantity_purchased >= 0),
  is_checked boolean NOT NULL DEFAULT false,
  notes text CHECK (notes IS NULL OR char_length(notes) <= 500),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bar_shopping_items_list ON umsuka.bar_shopping_items (shopping_list_id);
CREATE INDEX IF NOT EXISTS idx_bar_shopping_items_bar_item ON umsuka.bar_shopping_items (bar_item_id);
CREATE INDEX IF NOT EXISTS idx_bar_shopping_items_checked ON umsuka.bar_shopping_items (is_checked);

COMMENT ON TABLE umsuka.bar_shopping_items IS 'Items de la lista de la compra. bar_item_id nullable: si refiere a inventario, muestra stock actual; si no, es item libre. quantity_needed >0, is_checked marca comprado.';
COMMENT ON COLUMN umsuka.bar_shopping_items.bar_item_id IS 'FK a bar_items, nullable. SET NULL al borrar el producto. Usado para sugerir cantidad según stock.';
COMMENT ON COLUMN umsuka.bar_shopping_items.quantity_purchased IS 'Unidades ya compradas, para progreso parcial (opcional, default 0).';

-- ---------------------------------------------------------
-- 4. RLS — bar_shopping_lists
-- ---------------------------------------------------------
ALTER TABLE umsuka.bar_shopping_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE umsuka.bar_shopping_lists FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bar_shopping_lists_bar_lead" ON umsuka.bar_shopping_lists;
CREATE POLICY "bar_shopping_lists_bar_lead"
  ON umsuka.bar_shopping_lists FOR ALL TO authenticated
  USING (umsuka.is_workgroup_lead('barra') OR umsuka.is_super_admin())
  WITH CHECK (umsuka.is_workgroup_lead('barra') OR umsuka.is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE umsuka.bar_shopping_lists TO authenticated;
GRANT ALL ON TABLE umsuka.bar_shopping_lists TO service_role;

-- ---------------------------------------------------------
-- 5. RLS — bar_shopping_items
-- ---------------------------------------------------------
ALTER TABLE umsuka.bar_shopping_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE umsuka.bar_shopping_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bar_shopping_items_bar_lead" ON umsuka.bar_shopping_items;
CREATE POLICY "bar_shopping_items_bar_lead"
  ON umsuka.bar_shopping_items FOR ALL TO authenticated
  USING (umsuka.is_workgroup_lead('barra') OR umsuka.is_super_admin())
  WITH CHECK (umsuka.is_workgroup_lead('barra') OR umsuka.is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE umsuka.bar_shopping_items TO authenticated;
GRANT ALL ON TABLE umsuka.bar_shopping_items TO service_role;

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (idempotente)
-- [ ] ENUM bar_shopping_status existe con 2 valores open/closed
-- [ ] Table bar_shopping_lists existe con title 1-200, status open/closed, closed_at CHECK, índices status/created_by/created_at
-- [ ] Table bar_shopping_items existe con FK CASCADE/SET NULL, checks quantity>0, índices list/bar_item/checked
-- [ ] RLS enabled+forced en ambas; FOR ALL solo bar_lead/super_admin; GRANTS correctos
-- [ ] Non-bar-lead SELECT/INSERT/UPDATE/DELETE falla por RLS
-- [ ] Re-run idempotente sin errores
-- ---------------------------------------------------------
