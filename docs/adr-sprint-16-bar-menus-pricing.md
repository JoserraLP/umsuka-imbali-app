# ADR-016: Sprint 16 — Precios de Menús, Comidas y Bebidas (Responsable de Barra)

**Status:** Accepted (Implementado) · **Date:** 2026-09-02 · **Sprint:** 16 · **Branch:** `feature/sprint-16-bar-menus-pricing`

---

## Context

La barra necesita gestionar precios por categorías menu/food/drink y checklist privada de compra con sugerencia según stock. Solo responsable de barra (workgroup barra + is_workgroup_lead) y super_admin pueden crear/editar/toggle visibilidad y gestionar listas; miembros normales solo ven is_visible_to_members=true. Cada cambio de precio se audita. Dependencias Sprint 2 (workgroup RLS) y Sprint 3 base no existente → migraciones idempotentes from-scratch. Última migración 0076.

## Decisión

### D1 — ENUMs bar_category y bar_shopping_status idempotentes
`DO $$ CREATE TYPE ... EXCEPTION WHEN duplicate_object THEN NULL` siguiendo patrón auth_method_enum. Valores en inglés.

### D2 — Tablas bar_items + bar_price_history + triggers
bar_items 12 cols con CHECKs, índices category/visible/available/gin_trgm, trigger updated_at reutilizando umsuka.update_updated_at_column(). bar_price_history FK CASCADE. Trigger log_bar_price_change BEFORE UPDATE OF price WHEN DISTINCT FROM NEW price inserta old/new con auth.uid().

### D3 — Tablas shopping con RLS privado
bar_shopping_lists open/closed + closed_at CHECK coherencia; bar_shopping_items shopping_list_id CASCADE, bar_item_id SET NULL. RLS enable+force FOR ALL authenticated USING (is_workgroup_lead barra OR is_super_admin) en ambas.

### D4 — RLS bar_items SELECT true + filtro negocio
SELECT authenticated true (como documents/votings); filtro is_visible_to_members en getVisibleBarItems. Write solo bar_lead/super_admin. bar_price_history SELECT true, escritura solo vía trigger service_role.

### D5 — Lógica pura suggestQuantity
Stock <=0→20, <=5→15, <=10→10, <=20→5, >20→0, null→10. Variante byCategory drink +5. Testeable.

### D6 — Lib bar/menus y shopping con Zod y guards
Schemas en español, helpers isBarLead/canManageBar, mapBarItemRow, queries con filtros, mutations con requireAuthenticatedProfile + canManageBar + revalidatePath thin actions.

### D7 — UI /bar (pública) y /bar/admin (gestión)
AppShell guards: /bar visible todos autenticados con filtros y agrupación Tabs; /bar/admin solo canManageBar else redirect. Admin Tabs: Precios (tabla inline price/stock + toggles + histórico) + Lista compra (autocomplete stock + progress + cerrar).

---

## Alternativas

- RLS filtrando hide en DB via vista bar_items_visible descartada: complejidad, spec pide filtro negocio.
- UNIQUE(name,category) descartado: permitir homónimos.
- Hard delete vs soft: soft (available=false, visible=false) para no perder histórico.
- Bucket imágenes descartado fuera scope.

## Consecuencias

Positivo: CRUD completo con auditoría, checklist privada, sugerencia stock, RLS fail-closed, migraciones idempotentes, tests >85%.
Negativo: No paginación >50 items; sin notificación stock bajo (futuro Sprint 20).
Tradeoffs: visibilidad en app no en DB permite auditoría pero requiere disciplina uso queries.

## Seguridad

RLS ENABLE+FORCE, SELECT true / ALL bar_lead, grants autenticados limitado, history solo SELECT, trigger SECURITY DEFINER con search_path fijo. Validación Zod + CHECK >0 / >=0 + price numeric. No secretos en cliente.

## Verificación

Migraciones 077-078 checklist OK idempotente, lib/bar helpers testeados, mutations con mocks RLS matrix, sugiere stock borde, vitest/tsc/eslint limpios, build ok.

## Cambios

- `supabase/migrations/20260101007700_bar_menus_pricing.sql` CREATE
- `supabase/migrations/20260101007800_bar_shopping_lists.sql` CREATE
- `src/types/database.types.ts` MODIFY
- `src/lib/bar/authorization.ts` CREATE
- `src/lib/bar/menus.ts` CREATE
- `src/lib/bar/shopping.ts` CREATE
- `src/app/bar/actions.ts` CREATE
- `src/app/bar/page.tsx` CREATE
- `src/app/bar/admin/page.tsx` CREATE
- `src/components/bar/*` CREATE
- `src/components/layout/nav-links.ts` MODIFY
- `tests/unit/lib/bar-*` CREATE
- `docs/adr-sprint-16-bar-menus-pricing.md` CREATE
