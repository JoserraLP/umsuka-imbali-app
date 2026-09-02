# PLAN — Sprint 16 — Precios de Menús, Comidas y Bebidas (Responsable de Barra)

> **Rama:** `feature/sprint-16-bar-menus-pricing` (base `master` según `docs/git-conventions.md` §1.2.1)
> **Task file:** `tasks/sprint-16-bar-menus-pricing.json` — status → `planned`
> **Autor:** task-architect (muse-spark-1.2)
> **Fecha:** 2026-09-02
> **Dependencias:** Sprint 2 (Workgroup Roles — `is_workgroup_lead`, `is_super_admin`), Sprint 3 (Bar Pricing — base `bar_items`), Sprint 19 (Perfiles)

---

## 1. Análisis de Dependencias y Riesgos

### 1.1 Dependencias duras

| Dep | Qué aporta | Riesgo si falta |
|-----|------------|-----------------|
| **Sprint 2** | `umsuka.workgroup` ENUM (`telas/barra/estandarte/limpieza/ninguno`), columna `profiles.workgroup`, `profiles.is_workgroup_lead`, helpers `umsuka.is_workgroup_lead(text)`, `umsuka.current_user_workgroup()`, `umsuka.is_super_admin()` | Sin esto es imposible implementar RLS de Sprint 16. Verificado: `database.types.ts` ya expone `Workgroup`, y `supabase/migrations/20260101001900_workgroup_rls.sql` crea las 3 funciones SECURITY DEFINER. Estado: **OK** |
| **Sprint 3** | Se suponía creaba `umsuka.bar_items` y `bar_price_history`. **Búsqueda grep muestra que NUNCA se materializó** — no hay ninguna migración `*bar*`, no hay tablas en `database.types.ts`, no hay carpeta `src/lib/bar/`. | La migración de Sprint 16 debe crear tablas **from-scratch** pero con path idempotente `IF NOT EXISTS` + `ADD COLUMN IF NOT EXISTS` para ser segura si Sprint 3 se implementa después o ya existe parcialmente. |
| **Sprint 19** | Campos `profiles.component_type`, avatar, bio, etc., ya están en `database.types.ts`. No es bloqueante directo pero justifica usar `getCurrentProfile()`/`requireAuthenticatedProfile()` como gate. | Ninguno |
| **Infraestructura** | `umsuka.update_updated_at_column()` (usada en 0076), `is_management()` helper, `supabase/migrations/20260101007600_document_management.sql` como plantilla de estilo, `src/lib/members/queries.ts` + `src/lib/votings/*` + `src/lib/shifts/*` como patrones de lib | Copiar estructura de índices, comments, grants, RLS enable+force, política por-rol |

### 1.2 Riesgos técnicos

| # | Riesgo | Probabilidad | Impacto | Mitigación |
|---|--------|--------------|---------|------------|
| **R1** | **Colisión de nombres si Sprint 3 llega después** — dos migraciones crearían las mismas tablas con definiciones ligeramente distintas | Media | Alto | Migración 077 usa `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + no recrea ENUM si existe usando `DO $$ BEGIN CREATE TYPE ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`. Documentar orden: 077 debe ser idempotente y re-ejecutable |
| **R2** | **RLS demasiado restrictivo/laxo** — `bar_items` SELECT "para todos los autenticados" pero filtrado por `is_visible_to_members` solo en capa de negocio es sutil. Si se pone filtro en RLS, el responsable no vería ocultos; si no se filtra en UI, usuarios normales verían ocultos vía query directa | Media | Alto — filtración de datos de negocio | Patrón elegido (spec): RLS SELECT = `authenticated true` (como `documents` en 0076 y `votings`). Filtro `is_visible_to_members=true` **solo en `getVisibleBarItems()`** para vista pública. `getAllBarItems()` (solo bar-lead/super_admin) retorna todo. En tests, verificar que query directa sin filtro expone ocultos → es aceptado porque RLS no lo bloquea; la capa de negocio es la que debe usarse. Alternativa documentada en ADR: si se requiere bloqueo a nivel DB, crear vista `bar_items_visible` o política con `current_user_workgroup()`, pero no es lo pedido |
| **R3** | **Trigger de histórico: bucle infinito o duplica filas** si se hace `UPDATE price` que cambia también `updated_at` | Baja | Medio | Trigger `BEFORE UPDATE OF price ON bar_items` con `WHEN (OLD.price IS DISTINCT FROM NEW.price)` compara `numeric(10,2)`. Insertar solo cuando hay cambio real. Función `SECURITY DEFINER`, `SET search_path = umsuka`. No hacer `UPDATE` dentro del trigger sobre `bar_items` |
| **R4** | **ENUM `bar_category` vs reutilizar `workgroup`/`transaction_category`** — crear ENUM nuevo es correcto pero debe seguir el patrón de `workgroup_enum` (0076 no crea ENUM nuevo, 0020 sí). `bar_category` debe ser tipo propio `umsuka.bar_category` con valores `'menu','food','drink'` | Baja | Bajo | Usar bloque `DO` con `duplicate_object` guard como en `20260101002800_auth_method_enum.sql` |
| **R5** | **Shopping list sugiere `quantity_needed` basado en `stock_quantity`** — lógica de negocio ambigua ("stock bajo → sugerir reposición"). Si no se define umbral, implementación inconsistente | Media | Medio | Definir función pura `suggestQuantity(stock: number): number` con umbrales documentados: `stock <=0 → 20`, `stock <=5 → 10`, `stock <=10 → 5`, `>10 → 0 (no sugerir)`. Hacerla testeable y opcional en `addShoppingItemSchema` (si `quantity_needed` no se provee, se autocompleta) |
| **R6** | **`bar_shopping_items.bar_item_id` nullable + `name` text libre** — dualidad crea validación compleja (¿requiere uno de los dos? ¿puede tener ambos?) | Media | Medio | Schema Zod refine: `name` requerido siempre (1-200), `bar_item_id` opcional. Si `bar_item_id` existe, `name` se puede autocompletar pero se mantiene editable. FK `ON DELETE SET NULL` para no borrar items de lista si se borra el producto del menú |
| **R7** | **Falta de índices causa N+1 en `/bar` (filtros por categoría)** | Baja | Bajo | Índices: `bar_items(category, is_visible_to_members, is_available)`, `bar_price_history(bar_item_id, changed_at desc)`, `bar_shopping_items(shopping_list_id, bar_item_id)` |
| **R8** | **Confusión navegación: `/bar` vs `/bar/precios` vs `/bar/admin`** | Baja | Bajo | Decisión: `/bar` = vista pública (lista precios). `/bar/admin` = gestión + checklist. Redirigir `/bar/precios` → `/bar` si existe link legacy. Añadir `nav-links.ts` con showFor condicional |

### 1.3 Riesgos de planificación

- **Scope creep:** Añadir edición de imágenes, exportación PDF, o integración con `transactions` (finanzas) no pedidos. Cortar explícitamente en ADR.
- **UX compleja:** Checklist + inventario en misma página `/bar/admin` puede volverse pesada. Dividir en dos tabs: `Precios` y `Lista de la compra`.
- **Testing de RLS:** Requiere dos usuarios mock (bar-lead vs miembro normal). Usar helper `createMockSupabase` patrón `tests/unit/lib/votings-mutations.test.ts`.

---

## 2. Diseño de Migraciones SQL Exactas

### 2.1 Numeración y archivos

Dado que la última migración es `20260101007600_document_management.sql`, Sprint 16 propone **2 migraciones** (separadas por responsabilidad, como pide el task file pasos 1 y 2, y paso 3 RLS+trigger podría ir en la primera):

```
supabase/migrations/20260101007700_bar_menus_pricing.sql
supabase/migrations/20260101007800_bar_shopping_lists.sql
```

Alternativa válida: condensar en una sola 077 si el equipo prefiere atomicidad. Recomendación: **2 archivos** para facilitar review y revert parcial.

Ambas deben ser **idempotentes**: `IF NOT EXISTS`, `DROP POLICY IF EXISTS`, `DROP TRIGGER IF EXISTS`, `ON CONFLICT` para bucket si aplica, `ADD COLUMN IF NOT EXISTS`.

### 2.2 Migración 077 — `bar_items`, `bar_price_history`, ENUMs, RLS, Trigger

**Archivo:** `supabase/migrations/20260101007700_bar_menus_pricing.sql`
**Título comentario cabecera:** `-- 0077: bar menus pricing (Sprint 16) — bar_items, bar_price_history, RLS por responsable de barra`

#### 2.2.1 ENUM `bar_category`

```sql
DO $$ BEGIN
  CREATE TYPE umsuka.bar_category AS ENUM ('menu', 'food', 'drink');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Comentario
COMMENT ON TYPE umsuka.bar_category IS 'Categoría de producto de barra: menu (menú completo), food (comida suelta), drink (bebida).';
```

Nota: usar `EXCEPTION WHEN duplicate_object` como en `20260101002800_auth_method_enum.sql`. Valores en inglés **exactos** `menu/food/drink` (no `menus`).

#### 2.2.2 Tabla `umsuka.bar_items`

```sql
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
```

**Path idempotente si la tabla ya existía con schema parcial de Sprint 3** (sin `category`, `stock_quantity`, `is_visible_to_members`):

```sql
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS description text CHECK (...);
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS category umsuka.bar_category;
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS price numeric(10,2) CHECK (price > 0);
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS is_available boolean DEFAULT true;
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS is_visible_to_members boolean DEFAULT true;
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS stock_quantity int DEFAULT 0 CHECK (stock_quantity >= 0);
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES umsuka.profiles(id) ON DELETE SET NULL;
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();
ALTER TABLE umsuka.bar_items ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
-- Si category era text antes, migrar: ALTER TYPE ... USING ...
```

**Constraints adicionales idempotentes:**

- `UNIQUE (name, category)` opcional — debate: ¿puede haber dos "Cerveza" en categorías distintas? No aplicar UNIQUE global; dejar `name` no único. Si se decide unicidad, hacerlo `(name, category)` con índice único `CREATE UNIQUE INDEX IF NOT EXISTS`.
- Para simplificar: **sin UNIQUE** (permite homónimos, el responsable controla visibilidad). Documentar en ADR.

**Índices:**

```sql
CREATE INDEX IF NOT EXISTS idx_bar_items_category ON umsuka.bar_items (category);
CREATE INDEX IF NOT EXISTS idx_bar_items_visible ON umsuka.bar_items (is_visible_to_members);
CREATE INDEX IF NOT EXISTS idx_bar_items_available ON umsuka.bar_items (is_available);
CREATE INDEX IF NOT EXISTS idx_bar_items_created_by ON umsuka.bar_items (created_by);
CREATE INDEX IF NOT EXISTS idx_bar_items_name_trgm ON umsuka.bar_items USING gin (name gin_trgm_ops); -- requiere pg_trgm
CREATE EXTENSION IF NOT EXISTS pg_trgm;
```

**Trigger `updated_at`:**

```sql
DROP TRIGGER IF EXISTS trg_bar_items_updated_at ON umsuka.bar_items;
CREATE TRIGGER trg_bar_items_updated_at
  BEFORE UPDATE ON umsuka.bar_items
  FOR EACH ROW EXECUTE FUNCTION umsuka.update_updated_at_column();
```

`update_updated_at_column()` ya existe desde `20260101001800_workgroup_attendance.sql`; verificar que sigue vigente (usada en 0076).

**Comments:**

```sql
COMMENT ON TABLE umsuka.bar_items IS 'Productos de la barra (menús, comidas, bebidas). Solo responsable de barra (is_workgroup_lead barra) y super_admin escriben; lectura para todos los autenticados (filtro por visibilidad en capa de negocio).';
COMMENT ON COLUMN umsuka.bar_items.category IS 'ENUM menu/food/drink, obligatorio.';
COMMENT ON COLUMN umsuka.bar_items.is_visible_to_members IS 'Si false, oculto en /bar (vista pública) pero visible en /bar/admin para responsable.';
COMMENT ON COLUMN umsuka.bar_items.stock_quantity IS 'Inventario actual en unidades, >=0. Usado para sugerir cantidad en checklist.';
```

#### 2.2.3 Tabla `umsuka.bar_price_history`

```sql
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
```

Nota: `old_price` NULL para creación inicial (opcional: no insertar fila en creación, solo en updates). Política: no auditar creación, solo actualizaciones de `price`.

#### 2.2.4 RLS — `bar_items`

```sql
ALTER TABLE umsuka.bar_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE umsuka.bar_items FORCE ROW LEVEL SECURITY;

-- SELECT: todos los autenticados (igual que documents, votings, news)
DROP POLICY IF EXISTS "bar_items_select_authenticated" ON umsuka.bar_items;
CREATE POLICY "bar_items_select_authenticated"
  ON umsuka.bar_items FOR SELECT TO authenticated USING (true);

-- INSERT/UPDATE/DELETE: solo is_workgroup_lead('barra') OR is_super_admin()
DROP POLICY IF EXISTS "bar_items_write_bar_lead" ON umsuka.bar_items;
CREATE POLICY "bar_items_write_bar_lead"
  ON umsuka.bar_items FOR ALL TO authenticated
  USING (umsuka.is_workgroup_lead('barra') OR umsuka.is_super_admin())
  WITH CHECK (umsuka.is_workgroup_lead('barra') OR umsuka.is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE umsuka.bar_items TO authenticated;
GRANT ALL ON TABLE umsuka.bar_items TO service_role;
```

**Discusión clave:** No hay política separada para `toggleVisibility` — es un `UPDATE` más; el mismo RLS lo cubre. La separación es a nivel de mutación + auditoría.

#### 2.2.5 RLS — `bar_price_history`

```sql
ALTER TABLE umsuka.bar_price_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE umsuka.bar_price_history FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bar_price_history_select_authenticated" ON umsuka.bar_price_history;
CREATE POLICY "bar_price_history_select_authenticated"
  ON umsuka.bar_price_history FOR SELECT TO authenticated USING (true);

-- No INSERT/UPDATE/DELETE para authenticated: solo service_role y trigger (SECURITY DEFINER)
-- Forzar con política vacía pero FORCE RLS ya bloquea. Añadir explícita denegación no necesaria.
-- Sin embargo, dar GRANT SELECT pero no INSERT/UPDATE/DELETE a authenticated es defensa extra.

GRANT SELECT ON TABLE umsuka.bar_price_history TO authenticated;
GRANT ALL ON TABLE umsuka.bar_price_history TO service_role;
```

#### 2.2.6 Trigger histórico — `log_bar_price_change`

**Función trigger:**

```sql
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
```

Considerar `BEFORE UPDATE` vs `AFTER UPDATE`: usar `BEFORE` para que `changed_by` capture `auth.uid()` en la misma transacción; `AFTER` también vale pero `BEFORE` permite `WHEN`. Estandarizar en `BEFORE`.

### 2.3 Migración 078 — `bar_shopping_lists`, `bar_shopping_items`, ENUM status

**Archivo:** `supabase/migrations/20260101007800_bar_shopping_lists.sql`
**Título:** `-- 0078: bar shopping checklist (Sprint 16) — bar_shopping_lists, bar_shopping_items, RLS privado responsable de barra`

#### 2.3.1 ENUM `bar_shopping_status` o reutilizar text CHECK

Opción A: `CREATE TYPE umsuka.bar_shopping_status AS ENUM ('open','closed');`
Opción B: `status text CHECK (status IN ('open','closed'))` sin ENUM.

Recomendación **A con guard**, coherente con otros sprints que usan ENUM para estados (`user_status`, `audience_type`). Si el equipo prefiere evitar proliferación de ENUMs, usar CHECK. Aquí proponemos ENUM con guard.

```sql
DO $$ BEGIN
  CREATE TYPE umsuka.bar_shopping_status AS ENUM ('open', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
```

#### 2.3.2 Tabla `bar_shopping_lists`

```sql
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
```

Nota: `closed_at` nullable, CHECK garantiza coherencia. Trigger `updated_at` no necesario (solo `created_at` + `closed_at`).

#### 2.3.3 Tabla `bar_shopping_items`

```sql
CREATE TABLE IF NOT EXISTS umsuka.bar_shopping_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shopping_list_id uuid NOT NULL REFERENCES umsuka.bar_shopping_lists(id) ON DELETE CASCADE,
  bar_item_id uuid REFERENCES umsuka.bar_items(id) ON DELETE SET NULL, -- nullable, SET NULL si se borra producto
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
```

#### 2.3.4 RLS — `bar_shopping_lists` y `bar_shopping_items` (privado)

Ambas tablas **solo responsable de barra + super_admin** para todo (SELECT/INSERT/UPDATE/DELETE). No hay SELECT para miembros normales.

```sql
-- bar_shopping_lists
ALTER TABLE umsuka.bar_shopping_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE umsuka.bar_shopping_lists FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bar_shopping_lists_bar_lead" ON umsuka.bar_shopping_lists;
CREATE POLICY "bar_shopping_lists_bar_lead"
  ON umsuka.bar_shopping_lists FOR ALL TO authenticated
  USING (umsuka.is_workgroup_lead('barra') OR umsuka.is_super_admin())
  WITH CHECK (umsuka.is_workgroup_lead('barra') OR umsuka.is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE umsuka.bar_shopping_lists TO authenticated;
GRANT ALL ON TABLE umsuka.bar_shopping_lists TO service_role;

-- bar_shopping_items
ALTER TABLE umsuka.bar_shopping_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE umsuka.bar_shopping_items FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bar_shopping_items_bar_lead" ON umsuka.bar_shopping_items;
CREATE POLICY "bar_shopping_items_bar_lead"
  ON umsuka.bar_shopping_items FOR ALL TO authenticated
  USING (umsuka.is_workgroup_lead('barra') OR umsuka.is_super_admin())
  WITH CHECK (umsuka.is_workgroup_lead('barra') OR umsuka.is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE umsuka.bar_shopping_items TO authenticated;
GRANT ALL ON TABLE umsuka.bar_shopping_items TO service_role;
```

**Nota RLS para items:** Como `bar_shopping_items` no tiene columna `workgroup`, la política se basa en que los `shopping_lists` ya están restringidos, pero por seguridad directa se exige mismo rol. Alternativa con `EXISTS (SELECT 1 FROM bar_shopping_lists WHERE id = shopping_list_id AND (is_workgroup_lead...))` es redundante pero más fina; no necesaria si ambas tablas comparten misma política.

#### 2.3.5 Checklist manual de verificación (como en 0076, sección 5)

Añadir al final de cada migración un bloque comentario:

```sql
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
```
y equivalente para 078.

### 2.4 Consideraciones de `database.types.ts`

Tras aplicar migraciones, regenerar con `npm run supabase:gen-types`. Nuevos tipos esperados:

```ts
export type BarCategory = "menu" | "food" | "drink";
export type BarShoppingStatus = "open" | "closed";
Tables: bar_items, bar_price_history, bar_shopping_lists, bar_shopping_items
```

Hasta entonces, hand-authored en `src/types/database.types.ts` con TODO comment.

---

## 3. Diseño de Capas `lib/bar/menus.ts` y `lib/bar/shopping.ts`

### 3.1 Principios transversales

- **Patrón de referencia:** `src/lib/shifts/*` (schema separado de queries/mutations), `src/lib/votings/mutations.ts` (requireAuthenticatedProfile + requireManagementGuard), `src/lib/members/queries.ts` (mapRow + helper puro).
- **Autenticación:** Todas las mutations llaman `requireAuthenticatedProfile()` (de `src/lib/auth/session.ts`). Helpers puros `isBarLead(actor)` para testabilidad, espejando `isLeadOfGroup` de `members/authorization.ts`.
- **Errores:** Retornar `MutationResult { success: boolean, error?: string, id?: string }` como en `votings/mutations.ts`. No lanzar si es error de negocio; lanzar solo en queries si `supabase` error inesperado.
- **Renaming:** Mapear snake_case DB → camelCase TS en `mapBarItemRow` (como `mapMemberRow`).
- **Ubicación:** `src/lib/bar/menus.ts` y `src/lib/bar/shopping.ts` (dos archivos, no carpeta `lib/bar/` con sub-archivos, para mantener simplicidad). Si crece, extraer `lib/bar/authorization.ts` con `isBarLead`.

### 3.2 `src/lib/bar/menus.ts`

#### 3.2.1 Tipos de dominio

```ts
export type BarCategory = "menu" | "food" | "drink";
export const BAR_CATEGORIES = ["menu","food","drink"] as const;

export interface BarItem {
  id: string;
  name: string;
  description: string | null;
  category: BarCategory;
  price: number; // numeric(10,2) → number en JS
  isAvailable: boolean;
  isVisibleToMembers: boolean;
  stockQuantity: number;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BarItemWithHistory extends BarItem {
  history: BarPriceHistoryEntry[];
}

export interface BarPriceHistoryEntry {
  id: string;
  barItemId: string;
  oldPrice: number | null;
  newPrice: number;
  changedBy: string | null;
  changedAt: string;
}

export interface BarFilters {
  category?: BarCategory;
  isAvailable?: boolean;
  q?: string; // búsqueda por nombre/descripción
  // Solo para responsable: incluir ocultos y sin stock
  includeHidden?: boolean;
  minStock?: number;
  maxStock?: number;
}
```

#### 3.2.2 Schemas Zod

```ts
export const BAR_CATEGORY_VALUES = ["menu","food","drink"] as const;

export const createBarItemSchema = z.object({
  name: z.string().trim().min(1,"El nombre es obligatorio.").max(200),
  description: z.string().trim().max(1000).nullable().optional().transform(v => v ? v : null),
  category: z.enum(BAR_CATEGORY_VALUES, { errorMap: () => ({ message: "Categoría no válida." }) }),
  price: z.number().positive("El precio debe ser > 0.").max(99999999.99).or(z.string().transform(Number)).refine(n => n > 0),
  // Alternativa: price como string para evitar flotantes, parsear a numeric
  is_available: z.boolean().optional().default(true),
  is_visible_to_members: z.boolean().optional().default(true),
  stock_quantity: z.number().int().min(0).optional().default(0),
});

export const updateBarPriceSchema = z.object({
  id: z.string().uuid(),
  price: z.number().positive().max(99999999.99),
  // o price: z.string() con regex /^\d+(\.\d{1,2})?$/
});

export const updateStockSchema = z.object({
  id: z.string().uuid(),
  stock_quantity: z.number().int().min(0),
});

export const updateVisibilitySchema = z.object({
  id: z.string().uuid(),
  is_visible_to_members: z.boolean(),
});

export const toggleAvailabilitySchema = z.object({
  id: z.string().uuid(),
  is_available: z.boolean(),
});

export const barFiltersSchema = z.object({
  category: z.enum(BAR_CATEGORY_VALUES).optional(),
  q: z.string().trim().optional().transform(v => v ? v : undefined),
  isAvailable: z.boolean().optional(),
  includeHidden: z.boolean().optional(),
});
```

**Notas:**
- `price` como `z.number()` con `positive()` refleja `CHECK (price > 0)` y `numeric(10,2)`. Validar 2 decimales con `refine(v => Number.isInteger(v*100))` o usar `z.string().regex(/^\d+(\.\d{1,2})?$/)` y convertir a number en el handler — preferir `number` + refine para simplicidad UI (input type=number step=0.01).
- Todos los mensajes en español, como en `votings/schema.ts` y `shifts/schema.ts`.
- `createBarItemSchema` incluye `stock_quantity` y visibilidad para creación completa.

#### 3.2.3 Queries

```ts
// Helper puro para autorización (testeable)
export function isBarLead(actor: { role: string; isWorkgroupLead: boolean; workgroup: string }): boolean {
  return actor.isWorkgroupLead && actor.workgroup === "barra";
}
export function canManageBar(actor: { role: string; isWorkgroupLead: boolean; workgroup: string }): boolean {
  return isBarLead(actor) || actor.role === "super_admin";
}

// SELECT público: solo is_visible_to_members = true (y opcionalmente is_available)
export async function getVisibleBarItems(filters?: BarFilters): Promise<BarItem[]>
// SELECT gestión: todos (requiere bar-lead/super_admin, lanza AuthorizationError si no)
export async function getAllBarItems(filters?: BarFilters): Promise<BarItem[]>
// Por ID (uso interno, no filtra visibilidad)
export async function getBarItemById(id: string): Promise<BarItem | null>
// Histórico por item
export async function getBarPriceHistory(barItemId: string): Promise<BarPriceHistoryEntry[]>
// Histórico global paginado (opcional)
export async function getAllPriceHistory(limit?: number): Promise<BarPriceHistoryEntry[]>
```

**Implementación de `getVisibleBarItems`:** 
- `createClient()`, `from("bar_items").select("*").eq("is_visible_to_members", true).eq("is_available", ...).eq("category", ...).ilike("name", `%q%`)`. Orden `order("category").order("name")`.
- No necesita `requireAuthenticatedProfile()` si RLS permite SELECT authenticated; pero sí llamar `requireAuthenticatedProfile()` para gate si se quiere bloquear anon (middleware ya bloquea). Seguir patrón `getVotings()` que no pide auth explícito pero asume `createClient()` con sesión.

**Implementación de `getAllBarItems`:**
- `const actor = await requireAuthenticatedProfile(); if (!canManageBar(actor)) throw new AuthorizationError();` luego `select` sin filtro de visibilidad.

**`getBarPriceHistory`:** `select` ordenado por `changed_at desc`.

#### 3.2.4 Mutations

Todas siguen patrón `votings/mutations.ts`: parse Zod, guard, `createClient().insert/update`, manejo de unique violation `23505`, `notifyUsers` opcional no necesario aquí.

```ts
export async function createBarItem(input: CreateBarItemInput): Promise<MutationResult>
export async function updateBarItem(input: { id: string; ...fields }): Promise<MutationResult>
export async function updateBarPrice(input: UpdateBarPriceInput): Promise<MutationResult> // dispara trigger histórico
export async function updateStock(input: UpdateStockInput): Promise<MutationResult>
export async function toggleAvailability(input: ToggleAvailabilityInput): Promise<MutationResult>
export async function toggleVisibility(input: UpdateVisibilityInput): Promise<MutationResult>
export async function deleteBarItem(input: { id: string }): Promise<MutationResult> // soft delete opcional vs hard delete; spec dice is_available/is_visible, no borrar, pero mutations contempla delete físico solo para bar-lead
```

**Detalles por mutación:**

- **`createBarItem`**: valida `createBarItemSchema`, `requireAuthenticatedProfile()`, `if (!canManageBar) return { success:false, error:"Solo el responsable de barra..." }`, `insert({ name, description, category, price, ... , created_by: actor.id })`, `select("id").single()`, maneja `23505` si se activó unique.
- **`updateBarPrice`**: valida, guard, `update({ price: parsed.price }).eq("id")`, no necesita insertar en `history` manualmente (trigger lo hace). Retorna `MutationResult` con `id` del item.
- **`toggleVisibility`**: `update({ is_visible_to_members: parsed.is_visible_to_members })`.
- **`deleteBarItem`**: Decide: hard delete `delete().eq("id")` o soft `update({ is_available: false, is_visible_to_members: false })`. Spec dice "sin borrarlo" existe `is_available` y `is_visible`, pero también pide `deleteBarItem lógico`. Implementar como soft: `update({ is_available: false, is_visible_to_members: false })` y documentar que no hay borrado físico salvo `service_role`. Alternativa: hard delete permitido pero con confirmación; dejar ambos y priorizar soft.

**Helpers puros para tests:**

```ts
export function mapBarItemRow(row: any): BarItem { ... }
export function validateBarPrice(price: number): boolean { return price > 0 && price <= 99999999.99 }
```

### 3.3 `src/lib/bar/shopping.ts`

#### 3.3.1 Tipos

```ts
export type ShoppingStatus = "open" | "closed";

export interface ShoppingList {
  id: string;
  title: string;
  status: ShoppingStatus;
  createdBy: string | null;
  createdAt: string;
  closedAt: string | null;
  items: ShoppingItem[];
  progress: { total: number; checked: number; percent: number };
}

export interface ShoppingItem {
  id: string;
  shoppingListId: string;
  barItemId: string | null;
  name: string;
  quantityNeeded: number;
  quantityPurchased: number;
  isChecked: boolean;
  notes: string | null;
  createdAt: string;
  // Enriquecido si barItemId existe
  stockQuantity?: number | null; // de bar_items.stock_quantity
  category?: BarCategory | null;
  price?: number | null;
}
```

#### 3.3.2 Schemas Zod

```ts
export const createShoppingListSchema = z.object({
  title: z.string().trim().min(1,"El título es obligatorio.").max(200),
});

export const addShoppingItemSchema = z.object({
  shopping_list_id: z.string().uuid(),
  bar_item_id: z.string().uuid().nullable().optional(),
  name: z.string().trim().min(1).max(200),
  quantity_needed: z.number().int().positive("La cantidad debe ser > 0.").max(9999),
  notes: z.string().trim().max(500).nullable().optional().transform(v => v ? v : null),
  // quantity_purchased opcional al crear, default 0
}).refine(data => data.name.length > 0, { message: "Indica el nombre del producto." });

export const updateQuantitySchema = z.object({
  id: z.string().uuid(),
  quantity_needed: z.number().int().positive().optional(),
  quantity_purchased: z.number().int().min(0).optional(),
});

export const toggleCheckedSchema = z.object({
  id: z.string().uuid(),
  is_checked: z.boolean(),
});

export const closeShoppingListSchema = z.object({
  id: z.string().uuid(),
});
```

#### 3.3.3 Lógica `suggestQuantity`

Función pura, testeable:

```ts
/**
 * Sugiere quantity_needed basándose en stock_quantity actual.
 * Umbrales provisionales (ajustables por responsable):
 *   stock <= 0  -> 20  (agotado, reposición completa)
 *   stock <= 5  -> 15  (crítico)
 *   stock <=10  -> 10  (bajo)
 *   stock <=20  -> 5   (medio)
 *   stock >20   -> 0   (suficiente, no sugerir)
 * Si stock es null/undefined -> 10 (default).
 */
export function suggestQuantity(stockQuantity: number | null): number {
  if (stockQuantity === null || stockQuantity === undefined) return 10;
  if (stockQuantity <= 0) return 20;
  if (stockQuantity <= 5) return 15;
  if (stockQuantity <= 10) return 10;
  if (stockQuantity <= 20) return 5;
  return 0;
}

// Variante con categoría: bebidas consumen más rápido que menús
export function suggestQuantityByCategory(stock: number | null, category: BarCategory | null): number { ... }
```

Esta lógica se usa en UI: al seleccionar un `bar_item` del autocomplete, el campo `quantity_needed` se pre-rellena con `suggestQuantity(stock)`, pero es editable.

#### 3.3.4 Queries

```ts
export async function getShoppingLists(): Promise<ShoppingListSummary[]> // sin items, solo contadores
export async function getShoppingListWithItems(listId: string): Promise<ShoppingList | null>
export async function getOpenShoppingLists(): Promise<ShoppingListSummary[]>
export async function getBarItemsForShoppingAutocomplete(q: string): Promise<BarItem[]> // reutiliza bar_items search, muestra stock
```

- Todas las queries requieren `canManageBar(actor)` (mismo helper). Si no, `throw AuthorizationError`.
- `getShoppingListWithItems` hace 2 queries: `shopping_lists` + `shopping_items` + opcional enrich con `bar_items` para `stockQuantity`.

#### 3.3.5 Mutations

```ts
export async function createShoppingList(input: CreateShoppingListInput): Promise<MutationResult>
export async function addItemToShoppingList(input: AddShoppingItemInput): Promise<MutationResult>
export async function updateShoppingItemQuantity(input: UpdateQuantityInput): Promise<MutationResult>
export async function toggleShoppingItemChecked(input: ToggleCheckedInput): Promise<MutationResult>
export async function closeShoppingList(input: CloseShoppingListInput): Promise<MutationResult>
export async function deleteShoppingItem(input: { id: string }): Promise<MutationResult>
export async function deleteShoppingList(input: { id: string }): Promise<MutationResult> // cascade borra items
```

- **`createShoppingList`**: `insert({ title, status: 'open', created_by: actor.id })`.
- **`addItemToShoppingList`**: si `bar_item_id` presente, verificar que existe en `bar_items` (SELECT), autocompletar `name` si no viene, y opcionalmente sugerir `quantity_needed` si el caller no lo provee (pero schema lo requiere, así que caller ya usó `suggestQuantity`).
- **`toggleShoppingItemChecked`**: `update({ is_checked: true/false })`; al marcar checked, opcionalmente setear `quantity_purchased = quantity_needed`.
- **`closeShoppingList`**: `update({ status: 'closed', closed_at: new Date().toISOString() }).eq("id", id).eq("status","open")` — solo si está open. Si todos los items no están checked, permitir cerrar igual pero advertir en UI.

---

## 4. Diseño de Server Actions y Validación de Roles

### 4.1 Archivo `src/app/bar/actions.ts`

**Ubicación:** Una sola ruta `src/app/bar/actions.ts` para ambos dominios, o separar `src/app/bar/admin/actions.ts` si se prefiere colocación junto a la página admin. Recomendación: **un archivo** `src/app/bar/actions.ts` con re-export para `/bar/admin` (sigue patrón `src/app/votings/actions.ts` que está en un nivel).

**Directiva:** `"use server";` obligatoria.

**Firma (thin wrappers, como `votings/actions.ts`):**

```ts
"use server";
import { revalidatePath } from "next/cache";
import { createBarItem, updateBarPrice, toggleAvailability, toggleVisibility, updateStock } from "@/lib/bar/menus";
import { createShoppingList, addItemToShoppingList, toggleShoppingItemChecked, closeShoppingList } from "@/lib/bar/shopping";

export async function createBarItemAction(input: CreateBarItemInput) {
  const result = await createBarItem(input);
  if (result.success) { revalidatePath("/bar"); revalidatePath("/bar/admin"); }
  return result;
}
export async function updateBarPriceAction(input: UpdateBarPriceInput) { ... revalidatePath("/bar") ... }
export async function toggleBarItemAvailabilityAction(input: ToggleAvailabilityInput) { ... }
export async function toggleBarItemVisibilityAction(input: UpdateVisibilityInput) { ... }
export async function updateStockAction(input: UpdateStockInput) { ... }
export async function createShoppingListAction(input: CreateShoppingListInput) { ... revalidatePath("/bar/admin") ... }
export async function addShoppingItemAction(input: AddShoppingItemInput) { ... }
export async function toggleShoppingItemAction(input: ToggleCheckedInput) { ... }
export async function closeShoppingListAction(input: CloseShoppingListInput) { ... }
```

**Validación de roles:** No duplicar lógica de rol en la action; delegar a `lib/bar/*` que ya hace `requireAuthenticatedProfile()` + `canManageBar()`. La action solo revalida. Si se quiere defensa en profundidad, añadir `canManageBar` check también en la action, pero es redundante.

**Errores:** Las actions retornan `MutationResult` serializable (no `throw`). `AuthorizationError` se mapea a `{ success:false, error: "No tienes permisos..." }` dentro de `lib/bar/*`.

### 4.2 Validación adicional en server actions

- **Zod parse** ya ocurre en `lib/bar/*`; no re-parsear en action (single source of truth).
- **Rate limiting** no requerido para este sprint (sí en password-reset).
- **CSRF:** Next.js Server Actions ya incluyen protección; no añadir extra.

### 4.3 Revalidación

- `revalidatePath("/bar")` para vista pública.
- `revalidatePath("/bar/admin")` para gestión.
- Si se añade `/bar/[id]` detalle, revalidar también.
- Considerar `revalidateTag("bar_items")` si se usa `fetch` con tags, pero no es patrón actual (se usa `createClient()` directo).

---

## 5. Diseño de UI `/bar` y `/bar/admin`

### 5.1 Información general

- **AppShell:** Ambas páginas envueltas en `src/components/layout/AppShell` (o equivalente actual).
- **Guardas de ruta:** En `page.tsx`, `const profile = await getCurrentProfile(); if (!profile) redirect("/auth/login");` luego `if (!canManageBar(profile)) redirect("/bar")` para `/bar/admin`.
- **Navegación:** Añadir a `src/components/layout/nav-links.ts`:

```ts
{ href: "/bar", label: "Barra", icon: Beer /* o CupSoda | UtensilsCrossed */, showFor: () => true }, // visible para todos los autenticados
// La sub-ruta /bar/admin no necesita link directo; se accede vía botón "Gestionar" dentro de /bar si canManageBar.
// Alternativa: link condicional:
{
  href: "/bar/admin",
  label: "Gestión Barra",
  icon: Settings2,
  showFor: (ctx) => ctx.isWorkgroupLead && ctx.workgroup === "barra" || ctx.role === "super_admin",
}
```

Elegir icono disponible en `lucide-react`: `Beer`, `Wine`, `Utensils`, `ShoppingCart`. `Beer` es semántico para barra. Verificar que `lucide-react` exporta `Beer`.

### 5.2 `/bar` — Vista pública (todos los autenticados)

**Ruta:** `src/app/bar/page.tsx` (Server Component) + `src/app/bar/bar-client.tsx` (Client Component) o `src/components/bar/BarPublicList.tsx`.

**Layout:**

```
┌─────────────────────────────────────────────┐
│ Header: "Barra — Menús y Precios"           │
│ [+ Gestionar] (solo si canManageBar) -> /bar/admin │
├─────────────────────────────────────────────┤
│ Filtros: [Buscar] [Categoría: Todos|Menu|Food|Drink] [Solo disponibles toggle] │
├─────────────────────────────────────────────┤
│ Tabs o secciones agrupadas:                  │
│  MENUS (3 items)   |  COMIDAS (5) | BEBIDAS (8) │
│  Card: Nombre | Descripción | Precio (€) | Badge "No disponible" (atenuado) │
│  (sin precio/stock editable, sin visibilidad) │
└─────────────────────────────────────────────┘
```

**Comportamiento:**

- Query `getVisibleBarItems({ category, q, isAvailable })` — **solo** `is_visible_to_members=true`.
- Productos con `is_available=false` se muestran atenuados (`opacity-60`) con badge "No disponible" pero no se ocultan (a menos que filtro "Solo disponibles" esté activo).
- Productos con `is_visible_to_members=false` **no aparecen** (no hay forma de verlos).
- Buscador `q` con debounce 300ms, filta sobre `name` + `description` (ilike + trigram).
- Filtro categoría con `Tabs` (shadcn/ui).
- Empty state: "No hay productos disponibles."
- No expone `stock_quantity` ni historial ni checklist.

**Componentes propuestos:**

- `src/app/bar/page.tsx` — server, fetch inicial, pasa `initialItems` al client.
- `src/components/bar/BarFilters.tsx` — client, search + select.
- `src/components/bar/BarCategorySection.tsx` — renderiza grupo.
- `src/components/bar/BarItemCard.tsx` — shadcn Card.

**Accesibilidad:** Semántica `h2` por categoría, `aria-label` en badges.

### 5.3 `/bar/admin` — Gestión (solo responsable barra + super_admin)

**Ruta:** `src/app/bar/admin/page.tsx` (server, con guard) + client components.

**Guarda exacta:**

```ts
export default async function BarAdminPage() {
  const profile = await getCurrentProfile();
  if (!profile) redirect("/auth/login");
  if (!canManageBar(profile)) redirect("/bar"); // o throw AuthorizationError y mostrar 403
  // fetch getAllBarItems + getShoppingLists
}
```

**Layout en dos Tabs (shadcn Tabs):**

```
Tab 1: "Precios e Inventario"
Tab 2: "Lista de la Compra"
```

#### Tab 1 — Precios e Inventario

```
┌──────────────────────────────────────────────────────────┐
│ [Añadir nuevo producto] botón -> Dialog/Form            │
│ Tabla por categorías (collapsible o tabs internas):     │
│  Menus | Foods | Drinks                                   │
│  Columns: Nombre | Descripción | Categoría | Precio (€, editable inline) | Stock (editable inline) | Disponible [Toggle] | Visible [Toggle] | Histórico [Eye] | Eliminar (soft) │
└──────────────────────────────────────────────────────────┘
```

**Detalles:**

- **Formulario alta:** Dialog con `createBarItemSchema` (react-hook-form + zodResolver). Campos: `name`, `description`, `category` (Select), `price` (input number step 0.01), `stock_quantity` (number), `is_visible_to_members` (switch default true), `is_available` (switch). Al submit `createBarItemAction`, toast success, revalidate.
- **Edición inline precio/stock:** Clic en precio → input number + Save/Cancel. Valida `updateBarPriceSchema` / `updateStockSchema`. Muestra error inline.
- **Toggles:** Switch `is_available` → `toggleAvailabilityAction`; Switch `is_visible_to_members` → `toggleVisibilityAction`. Confirmación tooltip: "Ocultar a miembros: no aparecerá en /bar".
- **Histórico:** Botón Eye por fila → Sheet/Drawer que carga `getBarPriceHistory(itemId)` y lista `old → new (usuario, fecha)`. Reutiliza `date-fns` format.
- **Filtros admin:** mismos que pública pero incluye toggle "Mostrar ocultos" (por defecto true, porque admin ve todo). Badges de stock: `stock<=5` rojo, `<=10` amarillo.

**Componentes:**

- `src/app/bar/admin/page.tsx`
- `src/components/bar/admin/BarAdminTabs.tsx`
- `src/components/bar/admin/BarItemsTable.tsx`
- `src/components/bar/admin/BarItemFormDialog.tsx`
- `src/components/bar/admin/PriceHistoryDrawer.tsx`
- `src/lib/bar/menus.ts` queries ya descritos.

#### Tab 2 — Lista de la Compra (checklist)

```
┌──────────────────────────────────────────────────────────┐
│ Header: "Lista de la compra"                             │
│ [Crear nueva lista] input title + botón                 │
│ Lista de listas:                                         │
│  - Fiesta Verano (open) [Abrir] [Cerrar lista] Progreso 3/5 (60%) │
│  - Compra semanal (closed) [Ver] badge Cerrada          │
├──────────────────────────────────────────────────────────┤
│ Detalle lista seleccionada:                              │
│  [Añadir producto]                                       │
│    Autocomplete: busca en bar_items (muestra stock actual) + opción "Producto libre" │
│    Al seleccionar, quantity_needed pre-rellenado con suggestQuantity(stock) │
│    Campos: name, quantity_needed, notes                  │
│  Checklist items:                                        │
│    [ ] Cervezas x 20 (stock: 2) — nota: "Marca X"  [✓]  │
│    [x] Pan x 10 (stock: 12)                          [ ]  │
│  Progreso: Barra 60% (3/5 comprados)                    │
│  [Cerrar lista] botón (cambia status open->closed)      │
└──────────────────────────────────────────────────────────┘
```

**Comportamiento:**

- `getShoppingLists()` carga resúmenes; click en lista → `getShoppingListWithItems(id)` (client fetch via action o server prop).
- **Autocomplete:** Input con `cmdk` (shadcn Command) que consulta `getBarItemsForShoppingAutocomplete(q)` (o usa `getAllBarItems` cacheado). Muestra `name — stock: X — €precio`. Al elegir, `name` y `bar_item_id` se setean; `quantity_needed` se autocompleta con `suggestQuantity(stock)`. Si elige "Producto libre", `bar_item_id=null`, `name` libre.
- **Marcar comprado:** Checkbox → `toggleShoppingItemAction({ id, is_checked })`. Al marcar, UI tacha, contador incrementa. Opcional: `quantity_purchased` se setea a `quantity_needed`.
- **Progreso:** `percent = Math.round(checked/total*100)`. Barra `Progress` de shadcn.
- **Cerrar lista:** `closeShoppingListAction` → status `closed`, `closed_at` now. Items ya no editables; solo lectura. Botón deshabilitado si status closed.

**Permisos checklist:** Si un miembro normal navega a `/bar/admin`, el guard redirige. No hay RLS que deje pasar lectura de shopping_lists a normales (policy `bar_lead`).

### 5.4 Estados vacíos y manejo de errores

- Sin productos: "No hay productos. El responsable de barra puede añadir el primero."
- Sin listas: "No hay listas de la compra. Crea una para empezar."
- Error de mutación: Toast `sonner` con `error` del `MutationResult`.

---

## 6. Estrategia de Tests (Unitarios, Integración)

### 6.1 Estructura de archivos

```
tests/unit/lib/bar-menus-schema.test.ts
tests/unit/lib/bar-menus-mutations.test.ts
tests/unit/lib/bar-menus-queries.test.ts
tests/unit/lib/bar-shopping-schema.test.ts
tests/unit/lib/bar-shopping-suggestions.test.ts
tests/unit/lib/bar-shopping-mutations.test.ts
tests/unit/lib/bar-rls.test.ts          // opcional, integra políticas
tests/unit/components/bar-filters.test.tsx
tests/unit/app/bar-actions.test.ts
```

Reutilizar `vitest` con `jsdom`, mock de `createClient` y `requireAuthenticatedProfile` como en `tests/unit/lib/votings-mutations.test.ts`.

### 6.2 Tests unitarios — Schemas

- **`createBarItemSchema`**: 
  - OK: `{ name:"Menu Paella", category:"menu", price:12.5, stock_quantity:10 }`
  - Fail: `name` vacío, `name` >200, `description` >1000, `category` inválida (`postre`), `price` 0 o negativo, `price` NaN, `stock_quantity` -1, `stock_quantity` float.
  - Trim: `name:"  Cerveza "` → `"Cerveza"`.
  - Transform: `description:""` → `null`.
- **`updateBarPriceSchema`**: `price` 0 falla, `price` 99999999.99 ok, `price` 100000000 falla por max.
- **`updateStockSchema`**: int, >=0, float falla.
- **`updateVisibilitySchema`**: boolean.
- **`createShoppingListSchema`**: title 1-200, trim.
- **`addShoppingItemSchema`**: `quantity_needed` 0 falla, `quantity_needed` 1 ok, `name` vacío falla, `bar_item_id` opcional uuid o null.

### 6.3 Tests unitarios — Lógica pura

- **`suggestQuantity(stock)`**: casos borde `[ -1→20, 0→20, 1→15, 5→15, 6→10, 10→10, 11→5, 20→5, 21→0, null→10 ]`.
- **`suggestQuantityByCategory`**: verificar que drink sugiere +5 vs menu.
- **`isBarLead(actor)` / `canManageBar(actor)`**: matrix:
  - `{ isWorkgroupLead:true, workgroup:"barra", role:"member" }` → true
  - `{ isWorkgroupLead:true, workgroup:"telas" }` → false
  - `{ isWorkgroupLead:false, workgroup:"barra" }` → false
  - `{ role:"super_admin" }` → true incluso si no es lead
  - `{ role:"admin" }` → false (admin no es super_admin) — importante, spec dice solo `super_admin` + bar_lead, no cualquier `admin`.

- **`mapBarItemRow`**: snake→camel, `price` string→number, nulls.

### 6.4 Tests unitarios — Mutations (con mocks)

**Patrón `votings-mutations.test.ts`:** mock `src/lib/supabase/server` con `createClient` que retorna `{ from: vi.fn() }`, mock `src/lib/auth/session` con `requireAuthenticatedProfile`.

Casos por mutación:

- **`createBarItem`**:
  - Éxito si actor es bar_lead, inserta `created_by`.
  - Falla con `error:"Solo el responsable de barra..."` si actor es miembro normal.
  - Falla si `super_admin` → éxito (no es bar_lead pero es super).
  - Schema inválido → error de parse.
  - Supabase `error.code 23505` → mensaje friendly.
- **`updateBarPrice`**:
  - Verifica que no inserta en `bar_price_history` manualmente (eso lo hace el trigger) — test que `from("bar_price_history").insert` no es llamado.
  - Price sin cambios → no debe crear histórico (pero eso es test de trigger en integración).
- **`toggleVisibility`**: verifica que `update` usa `is_visible_to_members`.
- **`createShoppingList`/`addItem`/`toggleChecked`/`closeList`**: similar matrix de autorización.

### 6.5 Tests de integración — RLS

**Objetivo:** Validar que las políticas SQL realmente bloquean.

Estrategia: Como no hay entorno Supabase real en CI unitaria, se hace con mocks que simulan RLS o con tests `e2e` tipo `supabase` local (si existe). Alternativa: test de integración con `createClient` real contra `supabase` de test, usando `auth.uid()` mocks.

Si no hay DB de test, al menos testear la **lógica de la política** en JS:

```ts
describe("RLS bar_items", () => {
  it("SELECT permitido a cualquier authenticated", () => expect(policySelect({ role:"member" })).toBe(true));
  it("INSERT bloqueado a miembro normal", () => expect(policyWrite({ isWorkgroupLead:false, workgroup:"ninguno", role:"member" })).toBe(false));
  it("INSERT permitido a bar_lead", () => expect(policyWrite({ isWorkgroupLead:true, workgroup:"barra", role:"member" })).toBe(true));
  it("INSERT permitido a super_admin", () => expect(policyWrite({ role:"super_admin" })).toBe(true));
  it("INSERT bloqueado a lead de otro grupo", () => expect(policyWrite({ isWorkgroupLead:true, workgroup:"telas", role:"member" })).toBe(false));
});
```

Replicar para `bar_shopping_lists` (solo bar_lead/super_admin incluso para SELECT).

### 6.6 Tests de integración — Trigger histórico

- Insertar `bar_item` con `price=10`, luego `update price=12` → verificar que `bar_price_history` tiene 1 fila con `old_price=10, new_price=12, changed_by` = actor.
- `update name` sin cambiar `price` → 0 filas nuevas en history.

### 6.7 Tests de UI

- **Filtros `/bar`**: renderiza `BarFilters`, simula `userEvent.type` en buscador, verifica que `getVisibleBarItems` llamada con `q`.
- **Visibilidad:** renderiza lista con item `is_visible_to_members=false` → assert no aparece para `getVisibleBarItems` mock, sí aparece en `getAllBarItems` mock.
- **Checklist**: test de `ShoppingChecklist` component: `suggestQuantity` pre-rellena, toggle checkbox incrementa progreso, botón cerrar lista deshabilitado si `status==='closed'`.
- **Guards:** `BarAdminPage` redirige si `canManageBar` false.

### 6.8 Tests de Server Actions

Mock de `revalidatePath` (vi.fn()), verificar que se llama con `"/bar"` y `"/bar/admin"` solo en éxito, no en fallo.

### 6.9 Criterios de cobertura

- **Unit:** >85% en `lib/bar/*` (schemas + mutations + helpers puros).
- **Integración:** Al menos 1 test por política RLS (8 casos).
- **E2E manual:** Checklist de la migración (§2.3.5) + verificación manual en local: crear item como bar_lead, cambiar precio, ver histórico, ocultar, verificar que miembro normal no lo ve, crear lista, añadir item con stock, marcar, cerrar.

---

## 7. Orden de Implementación por Pasos

**Duración estimada total:** 4-5 días (1 dev senior, sin contar review). Ver desglose en §8.

### Fase 0 — Preparación (0.5 día)

1. **Checkout rama:** `git checkout master && git pull origin master && git checkout -b feature/sprint-16-bar-menus-pricing`
2. **Leer ADRs previos:** `docs/adr-sprint-02-workgroup-roles.md`, `docs/adr-sprint-03-bar-pricing.md` (si existe), `docs/adr-sprint-19-profiles.md` para contexto.
3. **Auditar DB real:** Conectar a Supabase staging, verificar si `bar_items` existe (`\dt umsuka.bar_items`). Si existe, `SELECT column_name FROM information_schema.columns`. Tomar captura para decidir path de migración.
4. **Crear stub tipos:** Añadir a `src/types/database.types.ts` los nuevos tipos con comentario `// TODO Sprint 16 — regenerar con supabase:gen-types` para que el compilador no falle antes de la migración.

### Fase 1 — Migraciones SQL (1 día)

5. **Escribir `20260101007700_bar_menus_pricing.sql`** con ENUM, tablas, índices, triggers, RLS, grants, comments, checklist. Seguir plantilla 0076. Probar local `supabase db reset` o `psql -f`.
6. **Escribir `20260101007800_bar_shopping_lists.sql`** con ENUM status, tablas, índices, RLS.
7. **Probar idempotencia:** Ejecutar cada migración 2x seguidas, verificar `NOTICE` no error.
8. **Verificar RLS manual:** Con `psql` como `authenticated` (SET ROLE), probar `INSERT INTO bar_items` como usuario normal vs bar_lead (cambiar `auth.uid()` vía `set_config('request.jwt.claim.sub', ...)`).
9. **Regenerar tipos:** `npm run supabase:gen-types` → actualizar `src/types/database.types.ts`. Commit parcial `feat(sprint-16): add bar_items and shopping migrations`.

### Fase 2 — Capa de negocio `lib/bar/menus.ts` (1 día)

10. **Crear `src/lib/bar/menus.ts`** con schemas Zod, tipos, `mapBarItemRow`, `isBarLead`, `canManageBar`, queries (`getVisibleBarItems`, `getAllBarItems`, `getBarPriceHistory`), mutations (`createBarItem`, `updateBarPrice`, `updateStock`, `toggleAvailability`, `toggleVisibility`, `deleteBarItem` soft).
11. **Crear `src/lib/bar/authorization.ts` (opcional)** extraído para reutilizar `isBarLead` en shopping.
12. **Tests unitarios schemas:** `tests/unit/lib/bar-menus-schema.test.ts` — TDD: escribir tests primero, luego ajustar schemas.
13. **Tests unitarios mutations:** `tests/unit/lib/bar-menus-mutations.test.ts` con mocks supabase/auth.
14. Commit `feat(sprint-16): add bar menus business layer and schemas`.

### Fase 3 — Capa de negocio `lib/bar/shopping.ts` (0.5 día)

15. **Crear `src/lib/bar/shopping.ts`** con schemas, `suggestQuantity`, queries, mutations.
16. **Tests:** `bar-shopping-schema.test.ts`, `bar-shopping-suggestions.test.ts`, `bar-shopping-mutations.test.ts`.
17. Commit `feat(sprint-16): add bar shopping checklist logic and stock suggestion`.

### Fase 4 — Server Actions (0.25 día)

18. **Crear `src/app/bar/actions.ts`** con thin wrappers, `revalidatePath` dual.
19. **Tests:** `tests/unit/app/bar-actions.test.ts` mock revalidate.
20. Commit `feat(sprint-16): add bar server actions with role validation`.

### Fase 5 — UI Pública `/bar` (0.75 día)

21. **Crear `src/app/bar/page.tsx`** (server) + `src/components/bar/BarPublicList.tsx` + `BarFilters.tsx` + `BarItemCard.tsx` + `BarCategorySection.tsx`.
22. **Integrar navegación:** editar `src/components/layout/nav-links.ts` añadir `{ href:"/bar", label:"Barra", icon:Beer }`.
23. **Estilos:** shadcn `Card`, `Tabs`, `Input`, `Badge`. Usar `tailwind` tokens existentes.
24. **Tests UI:** `tests/unit/components/bar-filters.test.tsx`.

### Fase 6 — UI Gestión `/bar/admin` (1 día)

25. **Crear `src/app/bar/admin/page.tsx`** con guard `canManageBar` y Tabs.
26. **Tab Precios:** `BarItemsTable.tsx` con TanStack Table o simple table, `BarItemFormDialog.tsx` con react-hook-form, inline editors, toggles, `PriceHistoryDrawer.tsx`.
27. **Tab Checklist:** `ShoppingLists.tsx`, `ShoppingListDetail.tsx`, `AddShoppingItemDialog.tsx` con autocomplete (`Command` + `Popover`), progreso, botón cerrar.
28. **Manejo de stock:** pasar `stockQuantity` a autocomplete, pre-rellenar `quantity_needed` con `suggestQuantity`.
29. Commit `feat(sprint-16): add bar public and admin UI`.

### Fase 7 — Pulido, Docs y Entrega (0.5 día)

30. **ADR:** Crear `docs/adr-sprint-16-bar-menus-pricing.md` (plantilla de `docs/adr-sprint-07-emailless-accounts.md`): Context, Decision (ENUM, RLS SELECT true + filtro negocio, trigger, suggestQuantity), Consequences, Alternatives, Security.
31. **Actualizar task file:** `tasks/sprint-16-bar-menus-pricing.json` status `planned` → `in_progress` → `done` según flujo; aquí ya se hizo `planned`.
32. **Linter/Typecheck:** `npx tsc --noEmit && npx eslint . --max-warnings=0`.
33. **Tests completos:** `npx vitest run`.
34. **Security scan:** `npm audit` o `sec` script.
35. **PR:** Crear PR según `docs/git-conventions.md` §3 (ver §7.1).
36. **Demo manual:** Responsable barra crea 3 items (menu/food/drink), cambia precio 2x, oculta 1, verifica miembro normal solo ve 2, crea lista, añade 2 items (uno con stock bajo → sugiere 15), marca 1, cierra lista.

### 7.1 Convenciones Git para este sprint

**Branch:** `feature/sprint-16-bar-menus-pricing` (ya definido en task file, coincide con `docs/git-conventions.md` ejemplo `feature/sprint-08-eventos-calendario`).

**Commits (Conventional Commits, scope `sprint-16` o `bar`):**

```
feat(sprint-16): add bar_items and shopping migrations with RLS and price history trigger
feat(sprint-16): add bar menus business layer with Zod schemas and queries
feat(sprint-16): add bar shopping checklist logic and stock suggestion
feat(sprint-16): add bar server actions with revalidation
feat(bar): add public bar price list and admin management UI
test(sprint-16): add unit and RLS integration tests for bar module
docs(sprint-16): add ADR for bar menus pricing
```

Cada commit <72 chars, imperativo presente, minúscula tras `:`.

**PR Title:** `[feature] Sprint 16 — Precios de Menús, Comidas y Bebidas (Responsable de Barra)`

**PR Body (según §3.2 de git-conventions):**

```markdown
## Summary
Implementa gestión de precios de barra por categorías menu/food/drink y checklist privada de compra para responsable de barra (workgroup barra + super_admin). Incluye migraciones con RLS estricto, trigger de histórico, capas lib/bar, server actions y UI /bar (pública filtrada) + /bar/admin (gestión + checklist).

## Related Task
**Task:** Sprint 16 — Precios de Menús, Comidas y Bebidas (Responsable de Barra) (ver tasks/sprint-16-bar-menus-pricing.json)
**Acceptance Criteria:**
- Solo responsable barra y super_admin gestionan precios/visibilidad/checklist
- Usuarios normales solo ven is_visible_to_members=true
- Checklist privada solo para responsable/super_admin
- Categorías menu/food/drink con filtro y stock visible para responsable
- Histórico de precios con autor y fecha
- Toggle disponible/oculto sin borrar
- Checklist con items de inventario (stock) o libres, cantidad y check

## Changes
- `supabase/migrations/20260101007700_bar_menus_pricing.sql` — CREATE
- `supabase/migrations/20260101007800_bar_shopping_lists.sql` — CREATE
- `src/types/database.types.ts` — MODIFY (bar_items, bar_price_history, shopping)
- `src/lib/bar/menus.ts` — CREATE
- `src/lib/bar/shopping.ts` — CREATE
- `src/lib/bar/authorization.ts` — CREATE
- `src/app/bar/actions.ts` — CREATE
- `src/app/bar/page.tsx` — CREATE
- `src/app/bar/admin/page.tsx` — CREATE
- `src/components/bar/*` — CREATE
- `src/components/layout/nav-links.ts` — MODIFY (Barra)
- `tests/unit/lib/bar-*` — CREATE

## Testing
- [x] Tests unitarios: `npx vitest run tests/unit/lib/bar-menus-schema.test.ts`
- [x] Tests unitarios: `npx vitest run tests/unit/lib/bar-shopping-suggestions.test.ts`
- [x] Tests integración RLS: `npx vitest run tests/unit/lib/bar-rls.test.ts`
- [x] Tests UI: `npx vitest run tests/unit/components/bar-filters.test.tsx`
- [x] Verificación manual: crear item como barra-lead, cambiar precio, ver histórico, ocultar, verificar que miembro normal no lo ve, crear lista, sugerir según stock

## ADR
Ver `docs/adr-sprint-16-bar-menus-pricing.md`

## Breaking Changes
- [ ] Sí
- [x] No
```

---

## 8. Estimación

| Fase | Días | Complejidad | Notas |
|------|------|-------------|-------|
| 0 Preparación | 0.5 | Baja | Auditoría DB + stubs |
| 1 Migraciones | 1.0 | Media-Alta | RLS + triggers, idempotencia, test manual |
| 2 lib/bar/menus | 1.0 | Media | Schemas, queries, mutations, tests |
| 3 lib/bar/shopping | 0.5 | Media | suggestQuantity + checklist |
| 4 Server Actions | 0.25 | Baja | Thin wrappers |
| 5 UI /bar | 0.75 | Media | Filtros, cards, nav |
| 6 UI /bar/admin | 1.0 | Alta | Dos tabs, dialogs, autocomplete, progreso |
| 7 Pulido/Docs/PR | 0.5 | Baja | ADR, lint, typecheck, PR |
| **Total** | **5.5** | | 1 dev senior, calendario 1 semana con buffer |
| **Optimista (con IA)** | **4.0** | | Si se reutiliza mucho de `votings`/`shifts` |

**Dependencia crítica:** Sin Fase 1 no se puede empezar Fase 2 (queries fallan). Fases 2 y 3 pueden paralelizarse con 2 devs.

---

## 9. Open Questions (bloqueantes / a decidir antes de implementar)

| # | Pregunta | Impacto | Propuesta |
|---|----------|---------|-----------|
| **Q1** | ¿Debe `bar_items.name` ser UNIQUE por categoría o globalmente? | Afecta índice único y mensaje de error 23505 | **Propuesta:** No UNIQUE; permitir duplicados y controlar por visibilidad. Si se quiere evitar confusión, añadir UNIQUE `(name, category)` con `CREATE UNIQUE INDEX IF NOT EXISTS`. Decidir en kickoff. |
| **Q2** | ¿`price` se guarda como `numeric(10,2)` con 2 decimales exactos o se permite más precisión? | Validación Zod + CHECK | **Propuesta:** 2 decimales exactos, `numeric(10,2)`, validar `price*100 % 1 == 0`. UI input `step=0.01`. |
| **Q3** | ¿Borrado físico de `bar_items` permitido o solo soft (`is_available=false`)? | Mutación `deleteBarItem` | **Propuesta:** Soft por defecto (no hay DELETE en UI); hard delete solo vía `service_role` o con confirmación y si `stock_quantity=0` y sin histórico reciente. Documentar. |
| **Q4** | ¿Umbrales de `suggestQuantity` consensuados con el responsable de barra real? | Lógica de negocio | **Propuesta:** Valores propuestos arriba (0→20, ≤5→15, ≤10→10, ≤20→5) son ajustables; exponer como constantes `SUGGEST_THRESHOLDS` para fácil tuning sin migración. |
| **Q5** | ¿La checklist debe notificar (Sprint 20) al responsable cuando stock baja? | Scope | **Propuesta:** Fuera de MVP Sprint 16; notar como follow-up. No integrar `notifyUsers` en esta entrega. |
| **Q6** | ¿`/bar` debe ser accesible a usuarios `pending`/`suspended`? | Guarda | **Propuesta:** No; `requireAuthenticatedProfile()` ya bloquea `pending`/`suspended` (ver `src/lib/auth/session.ts` líneas 47-53). Mantener. |
| **Q7** | ¿Precio debe mostrarse con IVA incluido o hay campo `tax`? | Schema | **Propuesta:** No; precio final único. Si se necesita IVA, añadir columna `tax_rate` en iteración posterior. |
| **Q8** | ¿La lista de la compra debe vincularse a un `carnival_year_id` (como `transactions`, `member_payments`)? | Modelo | **Propuesta:** No en MVP; todas las listas son globales. Si se quiere año carnaval, añadir `carnival_year_id` nullable FK como en 0072, pero fuera de spec actual. |
| **Q9** | ¿Se requiere paginación en `/bar` si hay >50 items? | UI | **Propuesta:** No inicial; lista <100 items. Añadir paginación o virtual scroll solo si escala. |
| **Q10** | ¿El histórico `bar_price_history` debe exponer `changed_by` nombre o solo ID? | Query | **Propuesta:** Enriquecer en `getBarPriceHistory` con join a `profiles` (first_name, last_name) como en `shifts/queries.ts` (two-query + map). |

---

## 10. Apéndice — Referencias de Patrones Existentes

- **Migración plantilla:** `supabase/migrations/20260101007600_document_management.sql` (228 líneas, estructura: tabla + índices + triggers + RLS enable+force + 2 políticas + grants + bucket + checklist).
- **Helper RLS:** `supabase/migrations/20260101001900_workgroup_rls.sql` (funciones `is_workgroup_lead`, `is_super_admin`).
- **RLS baseline:** `supabase/migrations/20260101001300_rls_policies.sql` ( `is_management()` ).
- **Lib patrón:** `src/lib/members/queries.ts` (mapRow, `getAllMembers`/`getWorkgroupMembers` con `AuthorizationError`), `src/lib/votings/mutations.ts` (requireManagementGuard, parseError, UNIQUE 23505), `src/lib/shifts/schema.ts` (WORKGROUPS, SHIFT_FORM_FIELDS), `src/lib/shifts/queries.ts` (getEventShifts con enrich + N+1 evitado), `src/lib/votings/queries.ts` (getVotings con optionCounts).
- **Server actions patrón:** `src/app/votings/actions.ts` (thin, revalidatePath dual).
- **Nav:** `src/components/layout/nav-links.ts` (showFor con `isWorkgroupLead && workgroup !== "ninguno"`).
- **Auth:** `src/lib/auth/session.ts` (`requireAuthenticatedProfile`, `getCurrentProfile` con status check), `src/types/auth.ts` (`AuthenticatedProfile`).
- **Tests patrón:** `tests/unit/lib/votings-mutations.test.ts` (mock `createClient`, `requireAuthenticatedProfile`, 23505).

---

> **Entregable para implementador:** Seguir orden Fase 0→7. No implementar código aquí; este plan es la única fuente de verdad para criterios de aceptación y diseño SQL. Cualquier desviación debe reflejarse en ADR y actualizar `tasks/sprint-16-bar-menus-pricing.json` (próximo status `in_progress`).

