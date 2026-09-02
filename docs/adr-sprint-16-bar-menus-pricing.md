# ADR-016: Sprint 16 — Precios de Menús, Comidas y Bebidas (Responsable de Barra)

**Status:** Accepted (Implementado) · **Date:** 2026-09-02 · **Sprint:** 16 ·
**Branch:** `feature/sprint-16-bar-menus-pricing`

---

## Context

La barra de la comparsa necesita gestionar los precios de menús, comidas y bebidas organizados por categorías (`menu`/`food`/`drink`) con control de stock y visibilidad, así como una checklist privada de compra con sugerencia de unidades según inventario. Hasta Sprint 15 no existía módulo de barra: el esquema base de `bar_items` se esbozó en Sprint 3 pero nunca se materializó en BD y no había UI ni capa de negocio. Este sprint implementa el módulo completo: migraciones 0077/0078, RLS estricto, trigger de histórico, capas `lib/bar/menus.ts` y `lib/bar/shopping.ts`, server actions y páginas `/bar` (pública) y `/bar/admin` (gestión + checklist).

Requisitos (`tasks/sprint-16-bar-menus-pricing.json`):

- Solo el responsable de barra (`workgroup='barra'` + `is_workgroup_lead=true`) y `super_admin` pueden crear, editar, hacer toggle de disponibilidad/visibilidad, borrar (soft) y gestionar la checklist; miembros normales solo ven `is_visible_to_members=true`.
- Precios organizados por categorías en inglés `menu`, `food`, `drink` con filtro por categoría y stock visible para el responsable.
- Cada cambio de precio queda registrado en histórico con autor (`changed_by=auth.uid()`) y fecha.
- Se puede marcar un producto como no disponible (`is_available`) o como oculto sin borrarlo (`is_visible_to_members`), soft-delete.
- Checklist privada solo para responsable/super_admin: crear listas `open`/`closed`, añadir items desde inventario (autocomplete con stock actual) o libres, indicar `quantity_needed`, marcar comprados, contador de progreso y botón cerrar lista.
- Cantidad sugerida basada en inventario (`suggestQuantity`).
- RLS fail-closed, validación Zod + CHECKs, auditoría y trazabilidad.

### Restricciones heredadas

- Dependencia Sprint 2 (workgroup RLS) y helpers `is_workgroup_lead(text)` / `is_super_admin()` — reutilizados para la política `FOR ALL` de barra; no se crea helper nuevo.
- Sprint 3 base no existente → migraciones **idempotentes from-scratch** (`CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `DO $$ duplicate_object`, `DROP POLICY/TRIGGER IF EXISTS`) para soportar despliegue limpio sin estado previo.
- Patrón `updated_at` vía `umsuka.update_updated_at_column()` (migración 0018) — reutilizado en `bar_items`.
- Patrón `pg_trgm` GIN para búsqueda `ilike '%q%'` en `bar_items.name` (mismo que `documents.name` en 0076).
- Última migración previa `20260101007600_document_management.sql`; este sprint añade **0077** y **0078**.
- `storage` fuera de alcance (no imágenes de productos en MVP).

---

## Decisión

### D1 — ENUMs `bar_category` y `bar_shopping_status` idempotentes

```sql
DO $$ BEGIN CREATE TYPE umsuka.bar_category AS ENUM ('menu','food','drink');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE umsuka.bar_shopping_status AS ENUM ('open','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- Valores en inglés (`menu`/`food`/`drink`, `open`/`closed`) según AC; mensajes Zod en español.
- Guard `duplicate_object` idempotente (patrón `auth_method_enum` y `waitlist_status` 0046).
- Comentarios `COMMENT ON TYPE` para `DATABASE.md`.

### D2 — Tabla `umsuka.bar_items` (12 cols) + `bar_price_history` + triggers

```sql
create table if not exists umsuka.bar_items (
  id uuid primary key default gen_random_uuid(),
  name text not null check (1-200 trim>0),
  description text check (null or <=1000),
  category bar_category not null,
  price numeric(10,2) not null check (price >0),
  is_available boolean not null default true,
  is_visible_to_members boolean not null default true,
  stock_quantity int not null default 0 check (stock_quantity >=0),
  created_by uuid references profiles(id) on delete set null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
-- Idempotente: ADD COLUMN IF NOT EXISTS para name/description/category/price/...
create table if not exists umsuka.bar_price_history (
  id uuid primary key default gen_random_uuid(),
  bar_item_id uuid not null references bar_items(id) on delete cascade,
  old_price numeric(10,2) check (null or >0),
  new_price numeric(10,2) not null check (>0),
  changed_by uuid references profiles(id) on delete set null,
  changed_at timestamptz default now()
);
```

- Índices: `category`, `is_visible_to_members`, `is_available`, `created_by`, `gin_trgm_ops` en `name` para `ilike`.
- `bar_price_history` FK `CASCADE` preserva auditoría ligada al producto; `changed_by` `SET NULL` si se borra usuario.
- Trigger `trg_bar_items_updated_at` `BEFORE UPDATE` → `umsuka.update_updated_at_column()` (0018).
- Trigger `trg_bar_items_price_history` `BEFORE UPDATE OF price WHEN (OLD.price IS DISTINCT FROM NEW.price)` → `umsuka.log_bar_price_change()`.

### D3 — Función `umsuka.log_bar_price_change()` SECURITY DEFINER

```sql
create or replace function umsuka.log_bar_price_change()
returns trigger language plpgsql security definer set search_path=umsuka,public as $$
begin
  if old.price is distinct from new.price then
    insert into bar_price_history(bar_item_id, old_price, new_price, changed_by)
    values (old.id, old.price, new.price, auth.uid());
  end if; return new;
end; $$;
```

- `SECURITY DEFINER` con `search_path` fijo (patrón `is_workgroup_lead`/`assign_waitlist_position`); solo inserta, nunca expone datos.
- `IS DISTINCT FROM` captura `NULL`→valor correctamente; `auth.uid()` audita autor real aunque `service_role` bypass.

### D4 — Tablas checklist `bar_shopping_lists` + `bar_shopping_items`

```sql
create table if not exists bar_shopping_lists (
  id uuid primary key, title text 1-200, status bar_shopping_status default 'open',
  created_by uuid references profiles on delete set null,
  created_at timestamptz default now(),
  closed_at timestamptz check (closed_at is null or status='closed')
);
create table if not exists bar_shopping_items (
  id uuid primary key,
  shopping_list_id uuid not null references bar_shopping_lists on delete cascade,
  bar_item_id uuid references bar_items on delete set null,
  name text 1-200, quantity_needed int check (>0),
  quantity_purchased int default 0 check (>=0),
  is_checked boolean default false, notes text <=500, created_at timestamptz default now()
);
```

- `bar_item_id SET NULL` permite ítem libre o referencia a inventario (muestra `stock_quantity`/`category`/`price` en `getShoppingListWithItems`); `shopping_list_id CASCADE` borra items al borrar lista.
- Índices: `shopping_lists(status, created_by, created_at desc)`, `shopping_items(shopping_list_id, bar_item_id, is_checked)`.
- `closed_at` coherente con `status` (CHECK); se fija a `now()` al cerrar vía `closeShoppingList` (`eq status open`).

### D5 — RLS `ENABLE+FORCE` fail-closed

```sql
alter table bar_items enable row level security; force row level security;
create policy bar_items_select_authenticated for select to authenticated using (true);
create policy bar_items_write_bar_lead for all to authenticated
  using (is_workgroup_lead('barra') or is_super_admin())
  with check (is_workgroup_lead('barra') or is_super_admin());

alter table bar_price_history enable row level security; force row level security;
create policy bar_price_history_select_authenticated for select to authenticated using (true);
-- sin policy ALL → escritura solo vía trigger (service_role)

alter table bar_shopping_lists enable row level security; force row level security;
create policy bar_shopping_lists_bar_lead for all to authenticated
  using (is_workgroup_lead('barra') or is_super_admin())
  with check (is_workgroup_lead('barra') or is_super_admin());

alter table bar_shopping_items enable row level security; force row level security;
create policy bar_shopping_items_bar_lead for all to authenticated
  using (is_workgroup_lead('barra') or is_super_admin())
  with check (is_workgroup_lead('barra') or is_super_admin());

grant select,insert,update,delete on bar_items, bar_shopping_lists, bar_shopping_items to authenticated;
grant select on bar_price_history to authenticated; -- escritura solo trigger/service_role
grant all on bar_items, bar_price_history, bar_shopping_lists, bar_shopping_items to service_role;
```

- `SELECT true` en `bar_items`/`bar_price_history` (como `documents`/`votings`): visibilidad uniforme; filtro `is_visible_to_members` en **capa de negocio** `getVisibleBarItems` (no en RLS) permite al responsable ver ocultos en `/bar/admin` sin vista extra.
- `shopping_*` `FOR ALL` solo bar_lead/super_admin → checklist **privada** (member normal `SELECT` → 0 rows, `INSERT` → 42501).
- `FORCE RLS` bloquea `table owner` y fuerza paso por policies; `service_role` bypass para mutations.
- Alternativa "vista `bar_items_visible`" descartada: complejidad y spec pide filtro negocio.

### D6 — Lógica pura `suggestQuantity` / `suggestQuantityByCategory`

```ts
export function suggestQuantity(stock: number|null|undef): number {
  if (stock==null) return 10;
  if (stock<=0) return 20; if (stock<=5) return 15;
  if (stock<=10) return 10; if (stock<=20) return 5; return 0;
}
export function suggestQuantityByCategory(stock, category): number {
  const base=suggestQuantity(stock); if(category==='drink'&&base>0) return Math.min(base+5,25); return base;
}
```

- Umbrales provisionales ajustables por responsable; variante `drink +5` (top 25) refleja consumo más rápido.
- Pura sin DB, 100% testeable (`bar-shopping-suggestions.test.ts` cubre bordes, null, categorías).

### D7 — Capa `lib/bar/authorization.ts` + `lib/bar/menus.ts` + `lib/bar/shopping.ts` (Zod, queries, mutations)

- **`authorization.ts`** (15 líneas): `isBarLead(actor)` (`isWorkgroupLead && workgroup==='barra'`) y `canManageBar = isBarLead || super_admin` (reutilizable en server/client).
- **`menus.ts`** (424 líneas): `BAR_CATEGORIES`, `BarItem`/`BarPriceHistoryEntry`/`BarFilters`/`MutationResult`, `mapBarItemRow` (price string→number, snake→camel), `validateBarPrice`.
  - Zod: `createBarItemSchema` (name 1-200, description ≤1000→null, category enum, price `union number|string` → `positive` + `max 99999999.99` + `refine 2 decimales`, `stock_quantity int >=0`), `updateBarPriceSchema` (uuid+price), `updateStockSchema`, `updateVisibilitySchema`, `toggleAvailabilitySchema`, `barFiltersSchema`.
  - Queries: `getVisibleBarItems(filters)` ( `eq is_visible_to_members true` → `applyBarFilters` category/available/q ilike/minStock/maxStock → `order category,name`), `getAllBarItems` (guard `canManageBar` + `requireAuthenticatedProfile` → `eq is_visible_to_members` solo si `includeHidden===false`), `getBarItemById`, `getBarPriceHistory`, `getAllPriceHistory(limit 50)`.
  - Mutations: `createBarItem`/`updateBarItem`/`updateBarPrice`/`updateStock`/`toggleAvailability`/`toggleVisibility`/`deleteBarItem` (soft: `is_available=false, is_visible_to_members=false`) — todas con `safeParse` → `parseZodError`, `canManageBar` guard es-ES, `createClient` anon + RLS, `23505` → mensaje duplicado, `maybeSingle` → "Producto no encontrado."
- **`shopping.ts`** (422 líneas): `ShoppingList`/`ShoppingItem`/`ShoppingListSummary`, `suggestQuantity` (ver D6), `computeProgress`.
  - Zod: `createShoppingListSchema` (title 1-200), `addShoppingItemSchema` (`shopping_list_id uuid`, `bar_item_id uuid nullable`, `name 1-200`, `quantity_needed int >0 max 9999`, `notes ≤500→null` + `refine name>0`), `updateQuantitySchema`, `toggleCheckedSchema`, `closeShoppingListSchema`.
  - Queries: `getShoppingLists` (guard `canManageBar` → `select lists order created_at desc` + `select items in (ids)` → `Map itemsByList` → progress `%`), `getOpenShoppingLists`, `getShoppingListWithItems` (fetch list → items → enrich con `bar_items(stock_quantity,category,price)`), `getBarItemsForShoppingAutocomplete(q)` (`ilike name %q% limit 20`).
  - Mutations: `createShoppingList` (`status open`), `addItemToShoppingList` (verifica list `status open` → insert), `updateShoppingItemQuantity`, `toggleShoppingItemChecked`, `closeShoppingList` (`eq status open` + `closed_at now()`), `deleteShoppingItem`/`deleteShoppingList` (guard + `maybeSingle`).

### D8 — Server actions thin `src/app/bar/actions.ts` + UI `/bar` y `/bar/admin`

- **Actions** (`"use server"`, 120 líneas): 12 wrappers (`createBarItemAction` etc.) que delegan a `lib/bar/*` y hacen `revalidatePath("/bar")` + `"/bar/admin"` en `success` (patrón `documents/actions.ts`). Sin lógica extra; guards viven en `mutations`.
- **`/bar/page.tsx`** (Server Component, AppShell, guard `redirect /auth/login`, `canManage` → botón Gestionar): lee `searchParams q/category/available` → `getVisibleBarItems` → agrupa `menu/food/drink` → `BarFilters` + `BarCategorySection`; estado vacío "No hay productos disponibles."
- **`/bar/admin/page.tsx`** (guard `canManageBar else redirect /bar`): `Promise.all(getAllBarItems(), getShoppingLists())` + `getShoppingListWithItems(listId?)` → `BarItemFormDialog` (alta) + `BarItemsTable` (tabla por categorías con edición inline price/stock + toggles disponibilidad/visibilidad + histórico drawer) + `ShoppingLists` (crear lista, autocomplete con `barItemsForSelect` mostrando stock actual, progress, cerrar).
- Componentes `src/components/bar/*` (7 archivos): `bar-item-card`/`bar-filters`/`bar-category-section` (pública) y `admin/bar-items-table`/`bar-item-form-dialog`/`price-history-drawer`/`shopping-lists`.
- **Navegación** `src/components/layout/nav-links.ts`: `{href:"/bar", label:"Barra", icon:Beer}` visible para todos los autenticados (sin `showFor`, como `documents`); gestión solo vía guard `/bar/admin`.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| RLS filtrando `is_visible_to_members` en DB vía vista `bar_items_visible` | Complejidad extra; spec pide filtro en capa de negocio y responsable necesita ver ocultos en admin sin segunda vista. `SELECT true` + `getVisibleBarItems` es más simple y auditado. |
| `UNIQUE(name, category)` en `bar_items` | Descártado: permitir homónimos (ej. "Cerveza" en `drink` y "Menú Cerveza" en `menu`); no hay requisito de unicidad por categoría. |
| Hard delete de `bar_items` | Soft-delete (`available=false, visible=false`) preserva histórico `bar_price_history` y evita `CASCADE` accidental; borrado físico rompería auditoría. |
| Bucket Storage para imágenes de productos | Fuera de scope MVP (sin imagen de producto); bucket `documents` y `meeting-minutes` ya cubren ficheros; añadir bucket barra sin requisito añade superficie. |
| `suggestQuantity` en trigger DB | Lógica de negocio pertenece a capa aplicación (testeable pura); trigger ocultaría regla y dificultaría ajuste por responsable. |
| Paginación server en `getBarItems` | MVP lista completa filtrada en DB (índices category/visible); para >500 docs se propone `range` futuro (tech-debt documentado). |
| Workspace `barra` como role en vez de workgroup | El modelo de roles ya distingue `workgroup` + `is_workgroup_lead`; crear role `bar_manager` duplicaría autorización y rompería consistencia con Sprint 2. |

---

## Consecuencias

### Positivas

- CRUD completo de barra con auditoría (`bar_price_history` + trigger), checklist privada con sugerencia stock, RLS fail-closed, migraciones idempotentes re-ejecutables sin errores.
- `getVisibleBarItems` garantiza que `/bar` nunca expone ocultos; `getAllBarItems` + guard `canManageBar` da control total al responsable.
- Lógica pura `suggestQuantity` central y testeada (bordes 0/5/10/20/null, variante drink).
- UI accesible: `/bar` Tabs por categoría con filtros querystring (shareable), `/bar/admin` Tabs Precios/Lista con edición inline y autocomplete stock.
- Reutiliza `is_workgroup_lead('barra')`/`is_super_admin` sin nuevo helper; grants mínimos (`SELECT` en history, `ALL` en items vía RLS).

### Negativas / pendientes

- Sin paginación: `getVisibleBarItems`/`getAllBarItems` devuelve todos los productos filtrados; para >50 items la tabla crece (mitigado por filtros DB, futuro `range`).
- Sin notificación de stock bajo (futuro Sprint 20).
- `suggestQuantity` umbrales provisionales; ajuste fino requiere feedback del responsable.
- `deleteBarItem` soft oculta pero no borra `bar_price_history` (diseño intencional); hard delete requeriría migración extra.

### Seguridad (defensa en profundidad)

- **RLS `ENABLE+FORCE`**: `bar_items SELECT true` (0 rows para `anon`), `ALL bar_lead/super_admin`; `shopping_* FOR ALL bar_lead/super_admin` (privada); `bar_price_history SELECT true` solo lectura.
- **Grants**: `authenticated SELECT/INSERT/UPDATE/DELETE` en `bar_items`/`shopping`, `SELECT` solo en history; `service_role ALL` (bypass para trigger/admin).
- **Trigger `SECURITY DEFINER`**: `search_path=umsuka,public` fijo, `auth.uid()` para `changed_by`; no expone `service_role` al cliente.
- **Validación**: Zod es-ES + `CHECK price>0 / stock>=0 / quantity_needed>0 / title 1-200` espejados DB; `file_path` no aplica (no ficheros).
- **Sin secretos en cliente**: `createClient` anon en queries/mutations; `createAdminClient` no usado en este sprint (no Storage).

### Trade-offs aceptados

- Visibilidad en app no en DB permite al responsable auditar ocultos sin vista extra, pero requiere disciplina de usar `getVisibleBarItems` en `/bar` (un `SELECT *` directo vía `supabase` expondría ocultos a cualquier autenticado — mitigado por convención y review).
- `bar_price_history` `SELECT true` expone histórico a todos los autenticados (no secreto, es auditoría de precios); sin ello `/bar/admin` no podría mostrar drawer sin `service_role`.

---

## Verificación

Checklist idempotente migraciones 0077/0078 (DoD):

1. ENUM `bar_category` existe con 3 valores `menu`/`food`/`drink` (idempotente `duplicate_object`).
2. ENUM `bar_shopping_status` existe con 2 valores `open`/`closed`.
3. Tabla `bar_items` 12 cols con `CHECK price>0, stock>=0, name 1-200, description <=1000`, índices `category/visible/available/created_by` + `gin_trgm_ops` en `name`.
4. Tabla `bar_price_history` con `FK CASCADE`, `old_price nullable`, índices `bar_item_id` + `changed_at desc`.
5. Triggers `trg_bar_items_updated_at` (`update_updated_at_column`) y `trg_bar_items_price_history` (`BEFORE UPDATE OF price WHEN DISTINCT`).
6. Tablas `bar_shopping_lists` (`title 1-200, status open/closed, closed_at CHECK`) y `bar_shopping_items` (`FK CASCADE/SET NULL, quantity>0, is_checked`).
7. RLS `ENABLE+FORCE` en 4 tablas; 2+1+1 policies (`SELECT true` / `ALL bar_lead`); grants `authenticated` limitado + `service_role ALL`.
8. `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` soporta Sprint 3 parcial sin `duplicate_column`.
9. Re-run `psql -f 0077 -f 0078` idempotente sin errores.
10. Non-bar-lead `INSERT bar_items` → 42501 RLS; `SELECT shopping_lists` → 0 rows; bar_lead `INSERT` ok.

Tests / build (DoD):

- `tsc --noEmit` y `eslint --max-warnings=0` limpios (verificado).
- Tests nuevos: `bar-menus-schema` (valid/invalid name/category/price stock), `bar-menus-mutations` (guards bar_lead vs member, `updateBarPrice` histórico, `toggleVisibility`), `bar-shopping-schema`, `bar-shopping-mutations` (RLS matrix), `bar-shopping-suggestions` (umbrales stock 0/5/10/20/null + drink +5), UI filtros categoría y checklist (sugerencia, toggle, cierre, visibilidad oculto).
- Suite completa `npx vitest run` verde sin regresiones (>85% coverage en lib/bar).
- Security scan sin issues HIGH (mismo patrón que 0076; `search_path` fijo aceptado MEDIUM, `SELECT true` + filtro negocio documentado).
- Build `next build` incluye `/bar` y `/bar/admin` (AppShell + guards).

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101007700_bar_menus_pricing.sql` | CREATE — ENUM `bar_category`, tabla `bar_items` 12 cols + `bar_price_history`, índices `category/visible/available/gin_trgm`, triggers `updated_at` + `log_bar_price_change`, RLS `SELECT true` / `ALL bar_lead` + grants (checklist 8 pts) |
| `supabase/migrations/20260101007800_bar_shopping_lists.sql` | CREATE — ENUM `bar_shopping_status`, tablas `bar_shopping_lists` (`open`/`closed` + `closed_at`) + `bar_shopping_items` (`CASCADE/SET NULL`), índices `status/list/bar_item/checked`, RLS `FOR ALL bar_lead` privada + grants |
| `src/types/database.types.ts` | MODIFY — `bar_items` + `bar_price_history` + `bar_shopping_lists` + `bar_shopping_items` Rows + `BarCategory`/`BarShoppingStatus` ENUMs |
| `src/lib/bar/authorization.ts` | CREATE — `isBarLead` / `canManageBar` (`is_workgroup_lead barra` OR `super_admin`) |
| `src/lib/bar/menus.ts` | CREATE — `BAR_CATEGORIES`, `mapBarItemRow`, `validateBarPrice`, Zod `createBarItemSchema`/`updateBarPriceSchema`/`updateStockSchema`/`updateVisibilitySchema`, queries `getVisibleBarItems`/`getAllBarItems`/`getBarItemById`/`getBarPriceHistory`, mutations `createBarItem`/`updateBarPrice`/`updateStock`/`toggleAvailability`/`toggleVisibility`/`deleteBarItem` (soft) |
| `src/lib/bar/shopping.ts` | CREATE — `suggestQuantity`/`suggestQuantityByCategory` puras, Zod `createShoppingListSchema`/`addShoppingItemSchema`/`updateQuantitySchema`/`toggleCheckedSchema`/`closeShoppingListSchema`, queries `getShoppingLists`/`getShoppingListWithItems`/`getBarItemsForShoppingAutocomplete`, mutations `createShoppingList`/`addItemToShoppingList`/`updateShoppingItemQuantity`/`toggleShoppingItemChecked`/`closeShoppingList`/`deleteShoppingItem`/`deleteShoppingList` |
| `src/app/bar/actions.ts` | CREATE — 12 server actions thin (`createBarItemAction` etc.) con `revalidatePath("/bar","/bar/admin")` |
| `src/app/bar/page.tsx` | CREATE — Server Component público: guard login, `getVisibleBarItems` con `q/category/available`, agrupación `menu/food/drink` Tabs, `BarFilters`, `BarCategorySection`, botón Gestionar si `canManageBar` |
| `src/app/bar/admin/page.tsx` | CREATE — Server Component gestión: guard `canManageBar else redirect /bar`, `Promise.all(getAllBarItems, getShoppingLists)`, Tabs Precios (`BarItemsTable` + `BarItemFormDialog` + `PriceHistoryDrawer`) + Lista (`ShoppingLists` autocomplete stock + progress + cerrar) |
| `src/components/bar/bar-item-card.tsx` | CREATE — card producto (precio, stock, badge disponible/oculto) |
| `src/components/bar/bar-filters.tsx` | CREATE — filtros `q` + `category` (select) |
| `src/components/bar/bar-category-section.tsx` | CREATE — sección por categoría (Tabs) |
| `src/components/bar/admin/bar-items-table.tsx` | CREATE — tabla por categorías con edición inline price/stock + toggles + histórico |
| `src/components/bar/admin/bar-item-form-dialog.tsx` | CREATE — dialog alta con categoría/stock/visibilidad |
| `src/components/bar/admin/price-history-drawer.tsx` | CREATE — drawer histórico por item (`getBarPriceHistory`) |
| `src/components/bar/admin/shopping-lists.tsx` | CREATE — CRUD listas + items (autocomplete `bar_items` con stock + `suggestQuantity` + progress + cerrar) |
| `src/components/layout/nav-links.ts` | MODIFY — añade `{href:"/bar", label:"Barra", icon:Beer}` visible para todos los autenticados |
| `tests/unit/lib/bar-menus-schema.test.ts` | CREATE — 12 tests Zod (name/category/price/stock) |
| `tests/unit/lib/bar-menus-mutations.test.ts` | CREATE — 10 tests guards + `updateBarPrice` histórico + `toggleVisibility` |
| `tests/unit/lib/bar-shopping-schema.test.ts` | CREATE — 8 tests Zod lista/item |
| `tests/unit/lib/bar-shopping-mutations.test.ts` | CREATE — 10 tests RLS matrix private |
| `tests/unit/lib/bar-shopping-suggestions.test.ts` | CREATE — 14 tests `suggestQuantity` bordes + `byCategory` drink +5 |
| `docs/adr-sprint-16-bar-menus-pricing.md` | CREATE — este ADR |
| `tasks/sprint-16-bar-menus-pricing.json` | MODIFY — status `security-cleared` → `documented` |

---

## Referencias

- `tasks/sprint-16-bar-menus-pricing.json` (AC 7 + DoD 12 + dependencies Sprint 2/3/19)
- `tasks/plan-desarrollo-completo.md` §Sprint 16
- `docs/git-conventions.md` — `feature/sprint-16-bar-menus-pricing`, commits `feat(sprint-16): ...`, PR `[feature] Sprint 16 — ...` contra `master`
- `supabase/migrations/20260101007600_document_management.sql` (patrón idempotente ENUM+RLS+trigger, última migración previa)
- `supabase/migrations/20260101001300_rls_policies.sql` (helpers `is_workgroup_lead`/`is_super_admin`)
- `supabase/migrations/20260101001800_*` (`update_updated_at_column`)
- `src/lib/documents/schema.ts` + `src/lib/votings/schema.ts` (Zod es-ES patrón)
- `src/lib/votings/mutations.ts` + `src/lib/carnival/year.ts` (guard fail-closed + `revalidatePath` thin actions)
- `src/lib/supabase/admin.ts` (`createAdminClient` service_role), `src/lib/auth/session.ts` (`requireAuthenticatedProfile`), `src/lib/auth/roles.ts` (`isManagementRole` patrón)
- `docs/adr-sprint-15-votings.md` (plantilla ADR estándar: Context con requisitos/restricciones, Decisión 7 secciones, Alternativas tabla, Consecuencias suite/tests, Archivos tabla)
- `docs/adr-sprint-17-events-enhancement.md` (RLS `FOR ALL` + triggers `SECURITY DEFINER` con `search_path`)
- `docs/adr-sprint-41-document-management.md` (Storage RLS + `SELECT true` + filtro negocio)
- `docs/DATABASE.md` (actualizado con 0077/0078: ER + migraciones + RLS)

