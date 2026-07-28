-- =========================================================
-- UMSUKA IMBALI APP — 0022: work_shift event type
-- =========================================================
-- Adds 'work_shift' as a valid event_type so workgroup leads
-- can create events specifically for tracking work shift
-- attendance, and grants them INSERT permission via RLS.

-- ---------------------------------------------------------
-- Extend event_type CHECK constraint
-- ---------------------------------------------------------
alter table umsuka.events
  drop constraint if exists events_event_type_check;

alter table umsuka.events
  add constraint events_event_type_check
  check (event_type in ('general', 'meeting', 'carnival', 'work_shift'));

comment on column umsuka.events.event_type is
  'Type of event: general, meeting, carnival, or work_shift (workgroup shift attendance).';

-- ---------------------------------------------------------
-- RLS: allow workgroup leads to INSERT work_shift events
-- ---------------------------------------------------------
create policy "events_insert_workgroup_lead"
  on umsuka.events for insert
  to authenticated
  with check (
    event_type = 'work_shift'
    and umsuka.is_workgroup_lead(
      (select workgroup from umsuka.profiles where id = auth.uid())
    )
  );

-- ---------------------------------------------------------
-- RLS: allow workgroup leads to UPDATE/DELETE their own
-- work_shift events (created_by = auth.uid())
-- ---------------------------------------------------------
create policy "events_update_own_work_shift"
  on umsuka.events for update
  to authenticated
  using (
    event_type = 'work_shift'
    and created_by = auth.uid()
  )
  with check (
    event_type = 'work_shift'
    and created_by = auth.uid()
  );

create policy "events_delete_own_work_shift"
  on umsuka.events for delete
  to authenticated
  using (
    event_type = 'work_shift'
    and created_by = auth.uid()
  );
