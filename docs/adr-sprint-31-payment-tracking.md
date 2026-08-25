# ADR-031: Sprint 31 — Control de Pagos y Reparto de Material (Payment Tracking)

**Status:** Accepted (Implementado) · **Date:** 2026-08-26 · **Sprint:** 31 ·
**Branch:** `feature/sprint-31-payment-tracking`

---

## Context

La comparsa necesitaba controlar las cuotas de los miembros (mensual/anual) y garantizar que solo los miembros al día reciban material en eventos de tipo `material_distribution` (reparto de material). La directiva registra pagos individuales o masivos por mes; cada miembro ve su historial en su perfil; al abrir un evento de reparto se generan dos listas (elegibles vs pendientes) y se pueden exportar/imprimir. Se debe evitar duplicados para el mismo periodo y aplicar RLS híbrida (directiva ve todo, miembro solo su historial).

Requisitos (`tasks/sprint-31-payment-tracking.json`):
- Directiva registra pagos mensuales/anuales individuales y masivos mensuales.
- Miembro ve su historial en perfil (tarjeta Estado de cuotas).
- Evento `material_distribution` genera lista elegibles (pagado hasta el mes del evento) vs pendientes.
- Export/print de la lista elegible.
- Sin duplicados mismo mes/año por miembro.
- RLS + guardsfail-closed.

Dependencias: Sprint 2 (Roles `is_management`), Sprint 17 (Eventos `event_type`), Sprint 19 (Perfil).

Patrones reutilizados: ENUM nativo, RLS `ENABLE+FORCE` + `is_management()` (0013), Zod isomórfico `optionalTrimmedText`, `MutationResult` + `requireManagementGuard`, server actions thin con `revalidatePath`, `database.types.ts` hand-edited + checklist.

Última migración: `20260101006300_legal_guardians.sql`; este sprint usa **0064**.

---

## Decisión

### D1 — ENUM `payment_type` (`monthly`/`yearly`) tipado fuerte

```sql
do $$ begin create type umsuka.payment_type as enum ('monthly','yearly'); exception when duplicate_object then null; end$$;
```

Dominio cerrado y estable como `transaction_type` (0062). Evita texto libre y habilita `::payment_type` en tipos.

### D2 — `period_month` nullable + CHECK coherente (una tabla vs dos)

```sql
period_month int check (period_month is null or (period_month between 1 and 12)),
period_year int not null check (period_year between 1 and 9999),
constraint chk_member_payment_month check (
  (payment_type='monthly' and period_month between 1 and 12) or
  (payment_type='yearly'  and period_month is null)
)
```

`monthly` exige 1-12, `yearly` exige `NULL`. Una tabla evita joins y simplifica `isPaidForMonth`. Dos tablas separarían lógica anual/mensual sin beneficio para <10k filas.

### D3 — Índices únicos parciales como invariante DB

```sql
create unique index uniq_member_monthly_payment on umsuka.member_payments (user_id, period_year, period_month) where payment_type='monthly';
create unique index uniq_member_yearly_payment on umsuka.member_payments (user_id, period_year) where payment_type='yearly';
```

Evitan duplicados a nivel DB incluso si la app-layer falla. La mutación mapea `duplicate key → "Ya existe un pago para ese miembro en el mismo periodo."`.

### D4 — Reutiliza `umsuka.is_management()` sin crear `is_directiva`

No se crea helper duplicado. `is_management()` (0013, `SECURITY DEFINER`, `stable`, grant a `authenticated`) ya cubre `MANAGEMENT_ROLES`. Ver ADR-24 D4, ADR-29 D2, ADR-30 D3.

### D5 — RLS híbrida (directiva escribe, miembro lee su historial)

```sql
create policy "member_payments_select_own_or_management" on umsuka.member_payments
  for select to authenticated using (umsuka.is_management() or user_id = auth.uid());
create policy "member_payments_write_management" on umsuka.member_payments
  for all to authenticated using (umsuka.is_management()) with check (umsuka.is_management());
```

SELECT híbrida: directiva ve todo, miembro ve `user_id = auth.uid()`. FOR ALL exclusiva directiva (insert/update/delete). A diferencia de `transactions` (0062) que es directiva exclusiva en SELECT, aquí el miembro debe ver su historial en perfil → híbrida es intencional y mínima. Sin políticas para `anon` → fallback deny.

### D6 — `material_distribution` como nuevo valor de `event_type`

```sql
alter type umsuka.event_type add value 'material_distribution';
```

Envuelto en `DO` con `IF NOT EXISTS` / `duplicate_object` para idempotencia (Postgres no soporta `ADD VALUE IF NOT EXISTS` en versiones antiguas). `src/lib/events/schema.ts` `EVENT_TYPES` se amplía; `src/types/database.types.ts` `EventType` idem; páginas de eventos/calendario añaden label naranja.

### D7 — Zod isomórfico con coherencia mensual/anual

`src/lib/payments/schema.ts`:
- `optionalTrimmedText(2000)` para `notes` (`""→null`).
- `payment_type enum`, `period_month` transform `NaN/null→null`, `period_year` 1-9999, `amount` coerce positive 2 decimales, `paid_at` `YYYY-MM-DD` con `isValidDateString`.
- `refine(paymentMonthCoherence)` coherente: mensual 1-12, anual null. Idéntica a CHECK DB.
- `bulkRegisterMonthlySchema` con `user_ids` min 1 + mismos `amount/paid_at`.
- `formatPaymentPeriod` helper para UI.

### D8 — `isPaidForMonth` puro + `getEligibilityForEvent`

`src/lib/payments/queries.ts`:
- `isPaidForMonth(payments, year, month)` → true si `yearly` del mismo año o `monthly` exacto. Acepta snake y camel para reuso en pure tests y `PaymentRow`.
- `getEligibilityForEvent(eventId)`: fetch `event_date` → `getPaymentsGroupedByUser()` (todos los pagos) → fetch perfiles activos (`is_active, status active, deleted_at null`) → partición elegibles/pendientes vía `isPaidForMonth`. Sin paginación (asumible <10k).
- `getPaidMembersForEvent(eventDate)` para API pura.

### D9 — `bulkRegisterMonthly` idempotente con reporte parcial

Loop `user_ids`: `insert` por miembro; `duplicate unique` → `skipped++`, error real → `errors[]`, éxito → `created++`. Retorna `{created, skipped, errors}` sin abortar en el primer duplicado. Caller muestra `Creados: X, omitidos: Y`.

### D10 — Una migración (0064) + tipos hand-edited

Sin CLI local, migración idempotente (`if not exists`, `drop policy if exists`, `create index if not exists`) + checklist de 14 comprobaciones. Fila 0064 en `docs/DATABASE.md`.

---

## Alternativas consideradas

| Alternativa | Motivo de rechazo |
|---|---|
| **Dos tablas `monthly_payments` / `yearly_payments`** | Duplicaría esquema, índices y queries; `isPaidForMonth` necesitaría unión. Una tabla con CHECK es más simple para <10k filas. |
| **ENUM `material` separado vs añadir a `event_type`** | Fragmentaría tipos de evento; `material_distribution` es un tipo de evento más (como `rehearsal`) y reutiliza toda la infraestructura de eventos. |
| **RLS directiva exclusiva (como transactions)** | Impediría que el miembro vea su historial en perfil sin service_role; híbrida es mínima y necesaria. |
| **Deduplicación solo app-layer sin índices únicos** | Race condition permitiría duplicados concurrentes; índice único parcial es invariante DB. |
| **Usar `supabase gen-types`** | Sin CLI local; hand-edited + `tsc` es patrón probado (ADR-24/29/30). |
| **Paginación en `getEligibilityForEvent`** | Prematuro para <10k; dos queries (pagos + perfiles) son suficientes. |

---

## Edge cases manejados

| Escenario | Comportamiento |
|---|---|
| No autenticado | `getCurrentProfile` → null → redirect `/auth/login`; mutations throw `Se requiere autenticación.` |
| `member` accede a `/payments` | Redirect `/dashboard`; RLS devuelve solo propias filas. |
| `member` llama mutations | Rechazo temprano `Solo la directiva puede gestionar los pagos.` sin tocar DB. |
| `period_month` fuera 1-12 / yearly con mes | Zod `refine` + CHECK DB `chk_member_payment_month`. |
| `amount` ≤0 o >2 decimales | Zod `positive` + `max 99.999.999,99` + refine 2 decimales; CHECK DB `>0`. |
| `paid_at` fecha inválida | Zod `isValidDateString`. |
| Duplicado mensual/anual | Índice único parcial → mapeado a `Ya existe un pago para ese miembro en el mismo periodo.`; bulk incrementa `skipped`. |
| `user_id` inexistente o borrado (`deleted_at`) | Mutations verifican `profiles` y rechazan `Miembro no encontrado.` / `no está disponible`. |
| Evento no encontrado en `getEligibilityForEvent` | Throw `Evento no encontrado.` |
| `user_id` NULL en `member_payments` | `mapRow` retorna null y se filtra (no debe ocurrir por app-layer, pero RLS lo tolera). |
| `anon` | Sin políticas → fallback deny. |
| Re-ejecución migración | Idempotente (`IF NOT EXISTS`, `DROP ... IF EXISTS`, `duplicate_object`). |

---

## Consecuencias

### Positivas

- **Flujo cuotas cerrado**: registro individual + masivo, historial en perfil, elegibilidad automática en reparto.
- **Elegibilidad pura testeable** (`isPaidForMonth`) sin DB.
- **Deduplicación fuerte** (DB + Zod) sin duplicados.
- **RLS híbrida mínima** que permite historial miembro sin exponer todo.
- **Suite nueva verde**: 35 tests nuevos (18 schema + 6 queries + 11 mutations) sobre **1374 tests en 92 archivos** (fue 1339/89 → +1 archivo por bottom-nav).
- **`tsc`/`eslint`/`next build` limpios** (`/payments` 4.05 kB, `/profile` 6.08 kB).
- **Cero helpers duplicados**: reutiliza `is_management()`.

### Seguridad (defensa en profundidad)

- **Sin surface `SECURITY DEFINER` nueva**.
- **RLS `ENABLE + FORCE`** en `member_payments`; checklist verifica `pg_policies` (2 políticas `to authenticated` con `is_management() OR user_id=auth.uid()`).
- **Fail-closed** en guards.

### Trade-offs / hallazgos conocidos

1. **Sin paginación** en `getEligibilityForEvent` / `getAllPayments`: asumible para <500 pagos; añadir `limit` si crece.
2. **`user_id` nullable en DB** (`SET NULL` on delete perfil) conserva historial contable aunque el miembro se borre soft; `mapRow` filtra nulls en lecturas.
3. **Bulk no transaccional**: cada insert es independiente; si 1 de 10 falla por error no-duplicado, 9 pueden quedar creados (`errors` reporta). Transacción completa requeriría RPC.

---

## Archivos

| Archivo | Cambio |
|---|---|
| `supabase/migrations/20260101006400_member_payments.sql` | CREATE — ENUM `payment_type` + tabla `member_payments` con CHECKs/índices únicos parciales + `ALTER TYPE event_type ADD VALUE 'material_distribution'` + RLS híbrida + checklist |
| `src/types/database.types.ts` | MODIFY — hand-edited: `PaymentType`, `EventType material_distribution`, `Tables.member_payments` + `Enums.payment_type` |
| `src/lib/events/schema.ts` | MODIFY — `EVENT_TYPES` incluye `material_distribution` |
| `src/lib/payments/schema.ts` | CREATE — Zod `register/update/delete/bulk` + `formatPaymentPeriod`, `MONTH_NAMES`, `isValidDateString`, `optionalTrimmedText` |
| `src/lib/payments/queries.ts` | CREATE — `getPaymentsByUser`, `getAllPayments`, `getPaymentsGroupedByUser`, `getPaidMembersForEvent`, `getEligibilityForEvent`, `isPaidForMonth`, `mapRow` |
| `src/lib/payments/mutations.ts` | CREATE — `registerPayment`, `updatePayment`, `deletePayment`, `bulkRegisterMonthly` con `requireManagementGuard` y mapeo unique violation |
| `src/lib/payments/actions.ts` | CREATE — 4 server actions thin con `revalidatePath("/payments","/profile","/events")` |
| `src/app/payments/page.tsx` | CREATE — página directiva con `getAllPayments` + `PaymentForm` + `BulkPaymentForm` + `PaymentList` |
| `src/app/payments/payment-form.tsx` | CREATE — form individual (tipo, mes/año, importe, fecha, notas) |
| `src/app/payments/bulk-payment-form.tsx` | CREATE — form masivo (multi-select miembros, mes/año, importe, fecha) con reporte `created/skipped` |
| `src/app/payments/payment-list.tsx` | CREATE — tabla pagos con delete |
| `src/app/profile/payment-status-card.tsx` | CREATE — tarjeta `Estado de cuotas` con historial del usuario |
| `src/app/profile/page.tsx` | MODIFY — integra `PaymentStatusCard` |
| `src/app/events/[id]/payment-eligibility.tsx` | CREATE — sección elegibles/pendientes para `material_distribution` |
| `src/app/events/[id]/export-payments-button.tsx` | CREATE — export CSV + print |
| `src/app/events/[id]/page.tsx` | MODIFY — integra `PaymentEligibility` cuando `eventType === 'material_distribution'` + label |
| `src/app/events/event-form.tsx` | MODIFY — label `material_distribution` |
| `src/app/events/page.tsx` | MODIFY — label |
| `src/app/calendar/page.tsx` | MODIFY — labels + dot/chip styles para `material_distribution` |
| `src/components/layout/nav-links.ts` | MODIFY — entrada `Pagos` (`/payments`, `CreditCard`, `showFor: isManagementRole`) |
| `tests/unit/lib/payments-schema.test.ts` | CREATE — 18 tests `register/update/delete/bulk/format` + edge 2 decimales, month coherence |
| `tests/unit/lib/payments-queries.test.ts` | CREATE — 6 tests `isPaidForMonth` puro (yearly, monthly, combinados, vacío) |
| `tests/unit/lib/payments-mutations.test.ts` | CREATE — 11 tests guards, Zod, `registered_by`, unique violation, not-found, bulk skip |
| `tests/unit/components/bottom-nav.test.tsx` | MODIFY — super_admin 18→19 (Pagos) |
| `docs/DATABASE.md` | MODIFY — fila 0064 |

### Tests

| Archivo | Tests |
|---|---|
| `tests/unit/lib/payments-schema.test.ts` (CREATE) | 18 — `register` mensual/anual válidos, monthly sin mes, yearly con mes, amount negativo/3 decimales, fecha inválida, `""→null`, longitud notes, uuid inválido; `update` uuid; `delete` uuid; `bulk` vacío/válido/mes inválido; `format` monthly/yearly; `isPaidForMonth` yearly |
| `tests/unit/lib/payments-queries.test.ts` (CREATE) | 6 — `isPaidForMonth` yearly cubre meses, yearly no cubre otro año, monthly exacto, combinado, vacío, múltiples con yearly |
| `tests/unit/lib/payments-mutations.test.ts` (CREATE) | 11 — `register` rechaza member, valida Zod, crea con `registered_by`, mapea unique, rechaza borrado; `update` rechaza member/not-found/success; `delete` uuid/not-found; `bulk` skip duplicados/rechaza member |

**Verificado en local (2026-08-26):** `npx vitest run` → **1374 tests en 92 archivos, todos pasando** (35 nuevos, 1 ajustado en `bottom-nav`); `npx tsc --noEmit` limpio; `npx eslint . --max-warnings=0` limpio; `npx next build` sin errores (`/payments` 4.05 kB). Security scan: CLEAR, 0 HIGH.

---

## Referencias

- Task file: `tasks/sprint-31-payment-tracking.json`
- ADR-030 (Legal Guardian): patrón para RLS `is_management()`, Zod isomórfico y checklist sin CLI
- ADR-029 (Money Management): patrón para finanzas con `is_management()` y `amount numeric(10,2)`
- Sprint 2 (`roles.ts` `MANAGEMENT_ROLES`) y migración 0013 (`is_management`)
- `docs/DATABASE.md`: fila 0064
- `docs/git-conventions.md`: rama `feature/sprint-31-payment-tracking`, commits `feat(sprint-31)`/`test(sprint-31)`/`docs(sprint-31)`
