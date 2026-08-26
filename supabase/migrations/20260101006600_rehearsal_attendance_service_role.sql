-- =========================================================
-- UMSUKA IMBALI APP — 0066: rehearsal attendance service_role grants (Sprint 32 follow-up)
-- =========================================================
-- Sprint 32 auto-enroll uses service_role (admin client) to bypass RLS
-- and upsert into rehearsal_attendance. The table created in 0058 never
-- received explicit table-level grants for service_role, so SELECT and
-- INSERT via service_role fail with 42501 permission denied (as seen in
-- production: rehearsal_attendance queries return 42501 even with
-- service_role). The initial schema only grants to `authenticated`, and
-- 0030/0033 only cover profiles/email_aliases/events/shifts.
-- This migration adds the missing grants. RLS is still FORCE, but
-- service_role bypasses RLS once it has table privileges.
-- ---------------------------------------------------------

-- SELECT needed to count/check existing rows and to list attendees
grant select on table umsuka.rehearsal_attendance to service_role;

-- INSERT/UPDATE/DELETE needed for auto-enroll upsert and attendance marking
grant insert, update, delete on table umsuka.rehearsal_attendance to service_role;

-- Also ensure the new column rehearsal_category on events is readable
-- by service_role (0033 already grants SELECT on events, but keep idempotent)
grant select on table umsuka.events to service_role;
