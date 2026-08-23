-- =========================================================
-- UMSUKA IMBALI APP — 0057: rehearsal event type (Sprint 27)
-- =========================================================
-- Adds 'rehearsal' to umsuka.event_type so management can create
-- rehearsal events with morning/afternoon sessions and mark
-- per-session attendance (table and constraints live in 0058).
--
-- WHY THIS IS A SEPARATE FILE: PostgreSQL's ALTER TYPE ... ADD VALUE
-- cannot be used in the same transaction that later USES the new value
-- (before PG 12 the statement cannot run inside a transaction block at
-- all; from PG 12 on it can, but the new value may not be referenced
-- until the transaction commits). Supabase wraps each migration file in
-- exactly one transaction, so the enum extension lives here, alone, and
-- 0058 (whose CHECK constraints compare event_type to 'rehearsal') runs
-- in its own transaction after this one has committed.
--
-- Safe to re-run: ADD VALUE IF NOT EXISTS and COMMENT statements are
-- idempotent.

alter type umsuka.event_type add value if not exists 'rehearsal' after 'work_shift';

-- ---------------------------------------------------------
-- Keep the type/column documentation in sync with the enum
-- ---------------------------------------------------------
comment on type umsuka.event_type is
  'Event category enum: general, meeting, carnival, work_shift, rehearsal.';
comment on column umsuka.events.event_type is
  'Type of event: general, meeting, carnival, work_shift, or rehearsal (session-based morning/afternoon attendance).';

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (no Supabase local/CLI in this environment; SQL is
-- hand-reasoned — pattern of the previous sprints). Verify before deploy:
--
-- [ ] umsuka.enum_range(NULL::umsuka.event_type) returns general,
--       meeting, carnival, work_shift, rehearsal — in that order
--       ('rehearsal' positioned AFTER 'work_shift').
-- [ ] Pre-existing rows keep their event_type values untouched.
-- [ ] comment on type umsuka.event_type and comment on column
--       umsuka.events.event_type list 'rehearsal'.
-- [ ] supabase db push applies the migration; re-running it is safe
--       (ADD VALUE IF NOT EXISTS does not duplicate the label).
-- [ ] 0058 (rehearsal_attendance) applies cleanly AFTER this migration:
--       its CHECK constraints reference 'rehearsal', which is only
--       usable once this file's transaction has committed.
-- ---------------------------------------------------------
