-- =========================================================
-- UMSUKA IMBALI APP — 0062: finances (Sprint 29)
-- =========================================================
-- Libro de ingresos/gastos de la comparsa. Solo directiva
-- (umsuka.is_management() = super_admin, admin, board_member,
-- event_manager — 0013) puede leer y escribir; el resto de
-- roles ve 0 filas (invisible, no solo oculto en menú).
--
-- Design decisions:
--   1. ENUMs nativos (transaction_type / transaction_category) para
--      tipado fuerte, alineado con rehearsal_session (0058). Dominio
--      cerrado y estable (bar_shift, bar_purchases, costume_materials,
--      dance_materials, other).
--   2. amount es numeric(10,2) SIEMPRE positivo; el signo lo da type
--      (income vs expense). CHECK amount > 0 rechaza 0 y negativos.
--   3. transaction_date es date (no timestamptz): la hora es irrelevante
--      para contabilidad de comparsa y simplifica filtros mensuales y
--      gráfica (evita off-by-one por TZ).
--   4. created_by ON DELETE SET NULL: conserva la transacción si se
--      borra el perfil (profiles es soft-delete; hard delete es
--      excepcional con service_role).
--   5. NO se crea is_directiva: se reutiliza umsuka.is_management()
--      (0013, SECURITY DEFINER, stable, grant to authenticated) que ya
--      cubre exactamente MANAGEMENT_ROLES. Crear otro helper duplicaría
--      la definición de directiva (ver ADR-24 D4).
--   6. RLS ENABLE + FORCE en umsuka.transactions. SELECT y FOR ALL =
--      is_management(). Sin políticas para anon => fallback deny.
--   7. updated_at via umsuka.update_updated_at_column() (0018).

-- ---------------------------------------------------------
-- 1. ENUM types
-- ---------------------------------------------------------
do $$ begin
  create type umsuka.transaction_type as enum ('income', 'expense');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type umsuka.transaction_category as enum (
    'bar_shift', 'bar_purchases', 'costume_materials', 'dance_materials', 'other'
  );
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------
-- 2. umsuka.transactions
-- ---------------------------------------------------------
create table if not exists umsuka.transactions (
    id uuid primary key default gen_random_uuid(),
    type umsuka.transaction_type not null,
    category umsuka.transaction_category not null,
    amount numeric(10,2) not null check (amount > 0),
    description text check (description is null or char_length(description) <= 2000),
    transaction_date date not null default current_date,
    created_by uuid references umsuka.profiles(id) on delete set null,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

comment on table umsuka.transactions is
  'Libro de ingresos/gastos de la comparsa. Solo directiva (is_management) puede leer/escribir; el resto ve 0 filas. amount siempre positivo; el signo lo da type.';

comment on column umsuka.transactions.type is
  'income = ingreso; expense = gasto. Signo de balance = SUM(income) - SUM(expense).';
comment on column umsuka.transactions.category is
  'Categoría: bar_shift (turno de barra), bar_purchases (compras barra), costume_materials (material traje), dance_materials (material baile), other.';
comment on column umsuka.transactions.amount is
  'Importe positivo con 2 decimales (numeric 10,2). Máximo 99.999.999,99.';
comment on column umsuka.transactions.transaction_date is
  'Fecha contable (date, no timestamptz). Default CURRENT_DATE.';
comment on column umsuka.transactions.created_by is
  'Perfil que creó la transacción. SET NULL si el perfil se borra (hard delete excepcional).';

-- ---------------------------------------------------------
-- 3. Indexes
-- ---------------------------------------------------------
create index if not exists idx_transactions_date
    on umsuka.transactions (transaction_date desc);
create index if not exists idx_transactions_type
    on umsuka.transactions (type);
create index if not exists idx_transactions_category
    on umsuka.transactions (category);
create index if not exists idx_transactions_created_by
    on umsuka.transactions (created_by);
create index if not exists idx_transactions_type_date
    on umsuka.transactions (type, transaction_date desc);
create index if not exists idx_transactions_created_at
    on umsuka.transactions (created_at desc);

-- ---------------------------------------------------------
-- 4. updated_at trigger
-- ---------------------------------------------------------
drop trigger if exists trg_transactions_updated_at on umsuka.transactions;

create trigger trg_transactions_updated_at
  before update on umsuka.transactions
  for each row
  execute function umsuka.update_updated_at_column();

-- ---------------------------------------------------------
-- 5. RLS — directiva exclusiva
-- ---------------------------------------------------------
alter table umsuka.transactions enable row level security;
alter table umsuka.transactions force row level security;

drop policy if exists "transactions_select_management" on umsuka.transactions;
create policy "transactions_select_management"
  on umsuka.transactions for select
  to authenticated
  using (umsuka.is_management());

drop policy if exists "transactions_write_management" on umsuka.transactions;
create policy "transactions_write_management"
  on umsuka.transactions for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (no Supabase local/CLI in this environment; SQL is
-- hand-reasoned — pattern of sprints 24/27/28). Verify before deploy:
--
-- [ ] Types umsuka.transaction_type / umsuka.transaction_category exist
--       with exactly ('income','expense') and 5 categories.
-- [ ] umsuka.transactions exists with columns, CHECKs and comments of
--       section 2 (amount > 0, description <=2000, id uuid pk).
-- [ ] Indexes of section 3 exist (date desc, type, category, created_by,
--       type+date, created_at desc).
-- [ ] trg_transactions_updated_at fires via
--       umsuka.update_updated_at_column() (0018) on UPDATE.
-- [ ] RLS: relrowsecurity = true AND relforcerowsecurity = true for
--       umsuka.transactions.
-- [ ] pg_policies shows exactly 2 policies: transactions_select_management
--       (select) and transactions_write_management (all), both
--       `to authenticated` with `using (umsuka.is_management())`.
-- [ ] Non-management (member) SELECT returns 0 rows; INSERT/UPDATE/DELETE
--       violate RLS (new row violates row-level security policy).
-- [ ] Management (super_admin/admin/board_member/event_manager) can
--       SELECT/INSERT/UPDATE/DELETE.
-- [ ] amount = 0 or negative fails CHECK; re-running migration is safe
--       (if not exists / do duplicate_object / drop policy if exists).
-- [ ] supabase db push applies migration; re-run is idempotent.
-- ---------------------------------------------------------
