-- =========================================================
-- UMSUKA IMBALI APP — 0048: cleanup attendance-only events
-- =========================================================
-- Since Sprint 17b, meeting (reunión) and carnival (carnaval) events
-- are attendance-only: shifts, shift assignments, workgroup attendance
-- and absences are unavailable for them (enforced in the server layer
-- and hidden in the UI). This migration removes any legacy data that
-- still exists for those event types.
--
-- general and work_shift events are NOT touched. The attendance table
-- is intentionally untouched: attendance is the only operative left for
-- meeting/carnival events.
--
-- Deletes run in dependency order: child rows (shift_assignments,
-- workgroup_attendance) before their parent shifts, then absences.
-- A plain DELETE ... USING with a join against umsuka.events keeps the
-- scope explicit; no transaction wrapper is needed (each statement is
-- atomic on its own).

-- ---------------------------------------------------------
-- 1. Remove shift assignments for shifts of meeting/carnival
--    events (child rows of shifts — delete first).
-- ---------------------------------------------------------
delete from umsuka.shift_assignments sa
using umsuka.shifts s
  inner join umsuka.events e on e.id = s.event_id
where sa.shift_id = s.id
  and e.event_type in ('meeting', 'carnival');

-- ---------------------------------------------------------
-- 2. Remove workgroup attendance for shifts of meeting/carnival
--    events (child rows of shifts — delete before shifts).
-- ---------------------------------------------------------
delete from umsuka.workgroup_attendance wa
using umsuka.shifts s
  inner join umsuka.events e on e.id = s.event_id
where wa.shift_id = s.id
  and e.event_type in ('meeting', 'carnival');

-- ---------------------------------------------------------
-- 3. Remove the shifts themselves for meeting/carnival events.
-- ---------------------------------------------------------
delete from umsuka.shifts s
using umsuka.events e
where s.event_id = e.id
  and e.event_type in ('meeting', 'carnival');

-- ---------------------------------------------------------
-- 4. Remove absences raised for meeting/carnival events
--    (absences.event_id references events; no cascade).
-- ---------------------------------------------------------
delete from umsuka.absences a
using umsuka.events e
where a.event_id = e.id
  and e.event_type in ('meeting', 'carnival');