-- =========================================================
-- UMSUKA IMBALI APP — 0077: bar menus pricing (Sprint 16)
-- =========================================================
-- bar_items, bar_price_history, RLS por responsable de barra
-- ENUMs, tablas, índices, RLS, trigger histórico, grants.
-- Idempotente: IF NOT EXISTS, ADD COLUMN IF NOT EXISTS, DROP POLICY/TRIGGER IF EXISTS.
--
-- Design decisions:
--   1. ENUM bar_category (menu/food/drink) con guard duplicate_object.
--   2. Tabla bar_items (12 cols) + índices category/visible/available/name_trgm.
--   3. Tabla bar_price_history (FK CASCADE, old_price nullable).
--   4. RLS enable+force: SELECT authenticated true (filtro is_visible en capa negocio);
--      ALL solo is_workgroup_lead('barra') OR is_super_admin().
--   5. Trigger log_bar_price_change BEFORE UPDATE OF price WHEN price distinto.
--   6. Grants: authenticated SELECT+INSERT/UPDATE/DELETE en bar_items, solo SELECT en history; all a service_role.

-- ---------------------------------------------------------
-- 1. ENUM bar_category
-- ---------------------------------------------------------
DO $$ BEGIN
  CREATE TYPE umsuka.bar_category AS ENUM ('menu', 'food', 'drink');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

COMMENT ON TYPE umsuka.bar_category IS 'Categoría de producto de barra: menu (menú completo), food (comida suelta), drink (bebida).';

-- ---------------------------------------------------------
-- 2. Tabla umsuka.bar_items
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS umsuka.bar_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 200 AND length(trim(name)) > 0),
  description text CHECK (description IS NULL OR char_length(description) <= 1000),
  category umsuka.bar_category NOT NULL,
  price numeric(10,2) NOT NULL CHECK (price > 0),
  is_available boolean NOT NULL DEFAULT true,
  is_visible_to_members boolean NOT NULL DEFAULT true,
  stock_quantity int NOT NULL DEFAULT 0 CHECK (stock_quantity >= 0),
  created_by uuid REFERENCES umsuka.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Idempotente: añadir columnas si la tabla existía parcialmente (Sprint 3)
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS description text CHECK (description IS NULL OR char_length(description) <= 1000);
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS category umsuka.bar_category;
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS price numeric(10,2) CHECK (price > 0);
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS is_available boolean DEFAULT true;
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS is_visible_to_members boolean DEFAULT true;
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS stock_quantity int DEFAULT 0 CHECK (stock_quantity >= 0);
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES umsuka.profiles(id) ON DELETE SET NULL;
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS name text CHECK (char_length(name) BETWEEN 1 AND 200 AND length(trim(name)) > 0);

COMMENT ON TABLE umsuka.bar_items IS 'Productos de la barra (menús, comidas, bebidas). Solo responsable de barra (is_workgroup_lead barra) y super_admin escriben; lectura para todos los autenticados (filtro por visibilidad en capa de negocio).';
COMMENT ON COLUMN umsuka.bar_items.category IS 'ENUM menu/food/drink, obligatorio.';
COMMENT ON COLUMN umsuka.bar_items.is_visible_to_members IS 'Si false, oculto en /bar (vista pública) pero visible en /bar/admin para responsable.';
COMMENT ON COLUMN umsuka.bar_items.stock_quantity IS 'Inventario actual en unidades, >=0. Usado para sugerir cantidad en checklist.';

CREATE INDEX IF NOT EXISTS idx_bar_items_category ON umsuka.bar_items (category);
CREATE INDEX IF NOT EXISTS idx_bar_items_visible ON umsuka.bar_items (is_visible_to_members);
CREATE INDEX IF NOT EXISTS idx_bar_items_available ON umsuka.bar_items (is_available);
CREATE INDEX IF NOT EXISTS idx_bar_items_created_by ON umsuka.bar_items (created_by);
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX IF NOT EXISTS idx_bar_items_name_trgm ON umsuka.bar_items USING gin (name gin_trgm_ops);

DROP TRIGGER IF EXISTS trg_bar_items_updated_at ON umsuka.bar_items;
CREATE TRIGGER trg_bar_items_updated_at
  BEFORE UPDATE ON umsuka.bar_items
  FOR EACH ROW EXECUTE FUNCTION umsuka.update_updated_at_column();

-- ---------------------------------------------------------
-- 3. Tabla umsuka.bar_price_history
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS umsuka.bar_price_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bar_item_id uuid NOT NULL REFERENCES umsuka.bar_items(id) ON DELETE CASCADE,
  old_price numeric(10,2) NULL CHECK (old_price IS NULL OR old_price > 0),
  new_price numeric(10,2) NOT NULL CHECK (new_price > 0),
  changed_by uuid REFERENCES umsuka.profiles(id) ON DELETE SET NULL,
  changed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_bar_price_history_item ON umsuka.bar_price_history (bar_item_id);
CREATE INDEX IF NOT EXISTS idx_bar_price_history_changed_at ON umsuka.bar_price_history (changed_at DESC);
CREATE INDEX IF NOT EXISTS idx_bar_price_history_item_changed_at ON umsuka.bar_price_history (bar_item_id, changed_at DESC);

COMMENT ON TABLE umsuka.bar_price_history IS 'Histórico de cambios de precio de bar_items. Solo inserta el trigger; lectura para todos los autenticados.';

-- ---------------------------------------------------------
-- 4. RLS — bar_items
-- ---------------------------------------------------------
ALTER TABLE umsuka.bar_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE umsuka.bar_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bar_items_select_authenticated" ON umsuka.bar_items;
CREATE POLICY "bar_items_select_authenticated"
  ON umsuka.bar_items FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "bar_items_write_bar_lead" ON umsuka.bar_items;
CREATE POLICY "bar_items_write_bar_lead"
  ON umsuka.bar_items FOR ALL TO authenticated
  USING (umsuka.is_workgroup_lead('barra') OR umsuka.is_super_admin())
  WITH CHECK (umsuka.is_workgroup_lead('barra') OR umsuka.is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE umsuka.bar_items TO authenticated;
GRANT ALL ON TABLE umsuka.bar_items TO service_role;

-- ---------------------------------------------------------
-- 5. RLS — bar_price_history
-- ---------------------------------------------------------
ALTER TABLE umsuka.bar_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE umsuka.bar_price_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bar_price_history_select_authenticated" ON umsuka.bar_price_history;
CREATE POLICY "bar_price_history_select_authenticated"
  ON umsuka.bar_price_history FOR SELECT TO authenticated USING (true);

GRANT SELECT ON TABLE umsuka.bar_price_history TO authenticated;
GRANT ALL ON TABLE umsuka.bar_price_history TO service_role;

-- ---------------------------------------------------------
-- 6. Trigger histórico — log_bar_price_change
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION umsuka.log_bar_price_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = umsuka, public
AS $$
BEGIN
  IF OLD.price IS DISTINCT FROM NEW.price THEN
    INSERT INTO umsuka.bar_price_history (bar_item_id, old_price, new_price, changed_by)
    VALUES (OLD.id, OLD.price, NEW.price, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;
COMMENT ON FUNCTION umsuka.log_bar_price_change() IS 'Trigger BEFORE UPDATE OF price ON bar_items: audita cambios de precio. Usa auth.uid() para changed_by.';

DROP TRIGGER IF EXISTS trg_bar_items_price_history ON umsuka.bar_items;
CREATE TRIGGER trg_bar_items_price_history
  BEFORE UPDATE OF price ON umsuka.bar_items
  FOR EACH ROW
  WHEN (OLD.price IS DISTINCT FROM NEW.price)
  EXECUTE FUNCTION umsuka.log_bar_price_change();

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (idempotente)
-- [ ] ENUM bar_category existe con 3 valores menu/food/drink
-- [ ] Table bar_items existe con 12 columnas, checks price>0, stock>=0, índices category/visible/available/name_trgm
-- [ ] Table bar_price_history existe con FK CASCADE, índices item+changed_at
-- [ ] Trigger trg_bar_items_updated_at actualiza updated_at
-- [ ] Trigger trg_bar_items_price_history inserta solo si price cambia
-- [ ] RLS enabled+forced en ambas; SELECT authenticated true, ALL solo bar_lead/super_admin; GRANTS correctos
-- [ ] Non-bar-lead INSERT/UPDATE/DELETE falla por RLS; SELECT sí ve filas
-- [ ] Re-run idempotente sin errores
-- ---------------------------------------------------------
