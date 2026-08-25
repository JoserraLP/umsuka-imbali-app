-- =========================================================
-- UMSUKA IMBALI APP — 0064: member payments + material_distribution (Sprint 31)
-- =========================================================
-- Control de cuotas de la comparsa (mensual/anual) y reparto
-- de material. Solo directiva (is_management) gestiona pagos;
-- miembros ven su propio historial. Al crear un evento tipo
-- material_distribution el sistema genera la lista de elegibles
-- (pagado hasta el mes del evento).
--
-- Design decisions:
--   1. ENUM nativo umsuka.payment_type (monthly/yearly) para
--      tipado fuerte, alineado con transaction_type (0062) y
--      rehearsal_session (0058). Dominio cerrado y estable.
--   2. period_month nullable: monthly exige 1-12, yearly exige
--      NULL. CHECKs coherentes evitan dos tablas separadas.
--   3. amount numeric(10,2) siempre positivo; CHECK > 0.
--   4. paid_at es date (no timestamptz): fecha contable sin hora.
--   5. Índices únicos parciales para deduplicación como invariante
--      DB (monthly: user+year+month, yearly: user+year) + validación
--      app-layer. Violación -> mensaje amigable.
--   6. RLS híbrida: SELECT = is_management() OR user_id = auth.uid()
--      (directiva ve todo, miembro ve su historial). FOR ALL =
--      is_management() (solo directiva escribe). Sin políticas para
--      anon => fallback deny.
--   7. event_type 'material_distribution' via ALTER TYPE ADD VALUE
--      (si no existe) — PostgreSQL no permite IF NOT EXISTS para
--      ADD VALUE, se envuelve en DO con manejo de excepción.
--   8. Reutiliza umsuka.is_management() (0013) sin crear is_directiva
--      duplicado (ver ADR-24 D4, ADR-29 D2, ADR-30 D3).
--   9. Sin CLI local: checklist manual.

-- ---------------------------------------------------------
-- 1. ENUM type
-- ---------------------------------------------------------
do $$ begin
  create type umsuka.payment_type as enum ('monthly', 'yearly');
exception when duplicate_object then null;
end $$;

-- ---------------------------------------------------------
-- 2. umsuka.member_payments
-- ---------------------------------------------------------
create table if not exists umsuka.member_payments (
    id uuid primary key default gen_random_uuid(),
    user_id uuid references umsuka.profiles(id) on delete set null,
    payment_type umsuka.payment_type not null,
    period_month int check (period_month is null or (period_month between 1 and 12)),
    period_year int not null check (period_year between 1 and 9999),
    amount numeric(10,2) not null check (amount > 0),
    paid_at date not null default current_date,
    registered_by uuid references umsuka.profiles(id) on delete set null,
    notes text check (notes is null or char_length(notes) <= 2000),
    created_at timestamptz not null default now(),
    constraint chk_member_payment_month check (
        (payment_type = 'monthly' and period_month between 1 and 12)
        or
        (payment_type = 'yearly' and period_month is null)
    )
);

comment on table umsuka.member_payments is
  'Cuotas de la comparsa por miembro. monthly exige period_month 1-12, yearly deja period_month null. Solo directiva escribe; miembro ve su propio historial. Deduplicación por índices únicos parciales.';

comment on column umsuka.member_payments.user_id is
  'Miembro que realizó el pago. SET NULL si el perfil se borra (conserva historial contable).';
comment on column umsuka.member_payments.payment_type is
  'monthly = cuota mensual (mes+año); yearly = cuota anual (cubre todo el año).';
comment on column umsuka.member_payments.period_month is
  'Mes 1-12 para monthly; NULL para yearly.';
comment on column umsuka.member_payments.period_year is
  'Año del pago (1-9999).';
comment on column umsuka.member_payments.amount is
  'Importe positivo con 2 decimales (numeric 10,2). Máximo 99.999.999,99.';
comment on column umsuka.member_payments.paid_at is
  'Fecha contable (date). Default CURRENT_DATE.';
comment on column umsuka.member_payments.registered_by is
  'Perfil de directiva que registró el pago. SET NULL si se borra.';
comment on column umsuka.member_payments.notes is
  'Notas opcionales (máx 2000).';

-- ---------------------------------------------------------
-- 3. material_distribution event type
-- ---------------------------------------------------------
do $$ begin
  alter type umsuka.event_type add value if not exists 'material_distribution';
exception
  when duplicate_object then null;
  when others then
    -- Fallback for Postgres versions without IF NOT EXISTS
    begin
      alter type umsuka.event_type add value 'material_distribution';
    exception when duplicate_object then null;
    end;
end $$;

-- ---------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------
create index if not exists idx_member_payments_user_id
    on umsuka.member_payments (user_id);
create index if not exists idx_member_payments_period_year
    on umsuka.member_payments (period_year);
create index if not exists idx_member_payments_user_year
    on umsuka.member_payments (user_id, period_year);
create index if not exists idx_member_payments_registered_by
    on umsuka.member_payments (registered_by);
create index if not exists idx_member_payments_created_at
    on umsuka.member_payments (created_at desc);
create index if not exists idx_member_payments_type
    on umsuka.member_payments (payment_type);

-- Unique partial indexes for deduplication
create unique index if not exists uniq_member_monthly_payment
    on umsuka.member_payments (user_id, period_year, period_month)
    where payment_type = 'monthly';

create unique index if not exists uniq_member_yearly_payment
    on umsuka.member_payments (user_id, period_year)
    where payment_type = 'yearly';

-- ---------------------------------------------------------
-- 5. RLS — directiva escribe, miembro lee su historial
-- ---------------------------------------------------------
alter table umsuka.member_payments enable row level security;
alter table umsuka.member_payments force row level security;

drop policy if exists "member_payments_select_own_or_management" on umsuka.member_payments;
create policy "member_payments_select_own_or_management"
  on umsuka.member_payments for select
  to authenticated
  using (umsuka.is_management() or user_id = auth.uid());

drop policy if exists "member_payments_write_management" on umsuka.member_payments;
create policy "member_payments_write_management"
  on umsuka.member_payments for all
  to authenticated
  using (umsuka.is_management())
  with check (umsuka.is_management());

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (no Supabase local/CLI in this environment; SQL is
-- hand-reasoned — pattern of sprints 29/30). Verify before deploy:
--
-- [ ] Type umsuka.payment_type exists with exactly ('monthly','yearly').
-- [ ] Type umsuka.event_type now includes 'material_distribution'.
-- [ ] umsuka.member_payments exists with columns, CHECKs and comments of
--       section 2 (amount >0, notes <=2000, chk_member_payment_month,
--       FKs SET NULL, created_at now(), paid_at default current_date).
-- [ ] Indexes of section 4 exist (user_id, period_year, user+year,
--       registered_by, created_at desc, type).
-- [ ] Unique partial indexes exist: uniq_member_monthly_payment
--       (user_id,period_year,period_month where monthly) and
--       uniq_member_yearly_payment (user_id,period_year where yearly).
-- [ ] RLS: relrowsecurity = true AND relforcerowsecurity = true for
--       umsuka.member_payments.
-- [ ] pg_policies shows exactly 2 policies:
--       member_payments_select_own_or_management (select) with
--       `using (is_management() or user_id = auth.uid())` and
--       member_payments_write_management (all) with `is_management()`.
-- [ ] Non-management SELECT returns only own rows (user_id = auth.uid());
--       other members' rows invisible.
-- [ ] Member INSERT/UPDATE/DELETE violates RLS.
-- [ ] Management can SELECT/INSERT/UPDATE/DELETE all rows.
-- [ ] Duplicate monthly (same user,year,month) fails unique violation;
--       duplicate yearly (same user,year) fails unique violation.
-- [ ] amount = 0 or negative fails CHECK; period_month out of 1-12
--       fails CHECK; yearly with period_month not null fails CHECK.
-- [ ] Re-running migration is safe (if not exists / drop policy if exists
--       / duplicate_object handling for types).
-- [ ] supabase db push applies migration; re-run is idempotent.
-- ---------------------------------------------------------
