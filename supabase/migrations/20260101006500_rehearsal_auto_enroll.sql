-- =========================================================
-- UMSUKA IMBALI APP — 0065: rehearsal auto-enroll (Sprint 32)
-- =========================================================
-- Auto-enroll for rehearsal events: when a rehearsal is created
-- with rehearsal_category (music/dance), every active member whose
-- profiles.component_type matches is pre-inserted into
-- rehearsal_attendance with enrolled=true (attended=false).
-- Members cannot self-enroll (RLS write = is_management()).
--
-- Design decisions:
--   1. rehearsal_category maps to profiles.component_type (music/dance),
--      NOT to workgroup (telas/barra/…). Workgroup values do not include
--      music/dance — see database.types.ts ComponentType vs Workgroup.
--      Corrected from plan-desarrollo-completo.md which said workgroup.
--   2. ENUM umsuka.rehearsal_category (music,dance) — native enum for
--      strong typing, same pattern as rehearsal_session (0058) and
--      payment_type (0064). Stable, closed domain.
--   3. events.rehearsal_category nullable, only for rehearsal type.
--      Permissive CHECK (rehearsal OR null) to avoid breaking legacy
--      rehearsal rows without category; Zod enforces required on create.
--   4. rehearsal_attendance.enrolled bool NOT NULL DEFAULT false +
--      enrolled_at timestamptz. CHECK coherence: enrolled=true =>
--      enrolled_at NOT NULL, enrolled=false => enrolled_at IS NULL
--      is enforced strictly to keep audit clean.
--   5. Idempotence via UNIQUE(event_id,user_id,session) (already exists):
--      auto-enroll uses upsert ON CONFLICT DO NOTHING; re-runs are no-ops.
--   6. One row per enabled session: morning_session true => morning row,
--      afternoon_session true => afternoon row, both => 2 rows/member.
--   7. RLS unchanged (FORCE): SELECT own_or_management, FOR ALL write
--      is_management(). Member INSERT => 42501. Auto-enroll uses
--      service_role (bypass) after management guard.
--   8. No trigger for retroactive enroll: member created after rehearsal
--      is not auto-enrolled (out of scope, requires job).

-- ---------------------------------------------------------
-- 1. ENUM umsuka.rehearsal_category
-- ---------------------------------------------------------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'rehearsal_category' and typnamespace = 'umsuka'::regnamespace) then
    create type umsuka.rehearsal_category as enum ('music', 'dance');
  end if;
end$$;

comment on type umsuka.rehearsal_category is
  'Ensemble category for rehearsal auto-enroll: music or dance. Maps to profiles.component_type, NOT workgroup.';

-- Ensure values exist idempotently (enum already created above covers it)
-- No ALTER TYPE ADD VALUE needed; values are music,dance in order.

-- ---------------------------------------------------------
-- 2. umsuka.events.rehearsal_category
-- ---------------------------------------------------------
alter table umsuka.events
  add column if not exists rehearsal_category umsuka.rehearsal_category null;

comment on column umsuka.events.rehearsal_category is
  'Ensemble auto-enrolled for rehearsal events (music/dance); NULL for non-rehearsal and legacy rehearsals without category. Maps to profiles.component_type.';

-- Permissive CHECK: non-rehearsal must have null; rehearsal may have null (legacy) or music/dance.
-- Use NOT EXISTS guard to keep migration idempotent on re-run.
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_events_rehearsal_category' and conrelid = 'umsuka.events'::regclass) then
    alter table umsuka.events
      add constraint chk_events_rehearsal_category
        check (event_type = 'rehearsal' or rehearsal_category is null);
  end if;
end$$;

-- ---------------------------------------------------------
-- 3. umsuka.rehearsal_attendance enrolled columns
-- ---------------------------------------------------------
alter table umsuka.rehearsal_attendance
  add column if not exists enrolled boolean not null default false,
  add column if not exists enrolled_at timestamptz null;

comment on column umsuka.rehearsal_attendance.enrolled is
  'true when member auto-enrolled at rehearsal creation (Sprint 32), false for manually marked or legacy rows.';
comment on column umsuka.rehearsal_attendance.enrolled_at is
  'When auto-enrollment occurred; NULL if not enrolled.';

-- Coherence: enrolled=true => enrolled_at NOT NULL, enrolled=false => enrolled_at IS NULL
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chk_rehearsal_enrolled_at' and conrelid = 'umsuka.rehearsal_attendance'::regclass) then
    alter table umsuka.rehearsal_attendance
      add constraint chk_rehearsal_enrolled_at
        check (
          (enrolled = true and enrolled_at is not null)
          or (enrolled = false and enrolled_at is null)
        );
  end if;
end$$;

-- Backfill: legacy rows keep enrolled=false, enrolled_at null (default already correct)

-- ---------------------------------------------------------
-- 4. Indexes
-- ---------------------------------------------------------
create index if not exists idx_rehearsal_attendance_event_enrolled
  on umsuka.rehearsal_attendance (event_id, enrolled);

-- ---------------------------------------------------------
-- 5. RLS — verify policies (no new policy needed, but ensure idempotent)
-- ---------------------------------------------------------
-- Policies already FORCE RLS from 0058:
--   rehearsal_attendance_select_own_or_management (SELECT authenticated using user_id=auth.uid() OR is_management())
--   rehearsal_attendance_write_management (FOR ALL authenticated using is_management() with check is_management())
-- No change: member INSERT must still fail 42501; service_role bypasses for auto-enroll.

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (no Supabase local/CLI; hand-reasoned, pattern 0058/0064)
-- Verify before deploy:
--
-- [ ] SELECT unnest(enum_range(NULL::umsuka.rehearsal_category)) = {music,dance} order music,dance
-- [ ] \d umsuka.events shows rehearsal_category umsuka.rehearsal_category NULL with comment
-- [ ] INSERT general with rehearsal_category='music' => FAIL chk_events_rehearsal_category
-- [ ] INSERT rehearsal with rehearsal_category null, morning_session true => OK (legacy permissive)
-- [ ] INSERT rehearsal with rehearsal_category='music', morning_session false, afternoon_session false => FAIL chk_events_rehearsal_has_session (0058)
-- [ ] \d umsuka.rehearsal_attendance shows enrolled bool NOT NULL DEFAULT false, enrolled_at timestamptz
-- [ ] INSERT rehearsal_attendance enrolled=true, enrolled_at null => FAIL chk_rehearsal_enrolled_at
-- [ ] INSERT rehearsal_attendance enrolled=false, enrolled_at now() => FAIL chk_rehearsal_enrolled_at
-- [ ] INSERT enrolled=true, enrolled_at=now() => OK
-- [ ] idx_rehearsal_attendance_event_enrolled exists (pg_indexes)
-- [ ] UNIQUE(event_id,user_id,session) still rejects duplicate with 23505
-- [ ] RLS FORCE: member INSERT rehearsal_attendance => 42501 violates RLS; management INSERT => OK; service_role bypass => OK
-- [ ] Auto-enroll idempotence: re-running upsert does not duplicate rows
-- [ ] supabase db push applies after 0064; re-running is safe (IF NOT EXISTS guards)
-- ---------------------------------------------------------
