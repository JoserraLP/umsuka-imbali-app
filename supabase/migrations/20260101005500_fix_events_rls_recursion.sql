-- =========================================================
-- UMSUKA IMBALI APP — 0055: fix events RLS infinite recursion
-- =========================================================
-- Sprint 18 introduced audience segmentation for events
-- (20260101005000): the events SELECT policy checks
-- umsuka.event_audience_users, and every event_audience_users
-- policy checks umsuka.events. Both tables run with FORCE RLS
-- (0013 for events, 0050 for event_audience_users), so evaluating
-- either policy for a regular (non-management) member re-enters the
-- other table's policies, which re-enter the first, and so on —
-- PostgreSQL aborts with
--   infinite recursion detected in policy for relation "events"
-- and the /dashboard event list fails with that error message.
--
-- Fix (canonical repo pattern — helper functions in migrations 0013
-- /0019/0050 are SECURITY DEFINER precisely "to avoid recursive RLS
-- lookups"): extract BOTH subqueries into SECURITY DEFINER
-- functions. They run with the privileges of their owner (postgres,
-- the migration role) and are resolved outside the policy machinery,
-- so the mutual chain is broken at both ends:
--
--   1. umsuka.is_event_creator(p_event_id uuid)       — used by the
--      four event_audience_users policies (was: inline exists over
--      umsuka.events).
--   2. umsuka.is_event_audience_member(p_event_id uuid) — used by
--      events_select_authenticated (was: inline exists over
--      umsuka.event_audience_users).
--
-- The five policies are dropped and recreated with EXACTLY the same
-- semantics as 0050 (same conditions, same ordering, same operators);
-- only the inline correlated subqueries are replaced by the helper
-- calls. The original policies in 20260101005000 are left untouched —
-- this migration supersedes them at deploy time (repo pattern).
--
-- Structure:
--   1. umsuka.is_event_creator(uuid)
--   2. umsuka.is_event_audience_member(uuid)
--   3. events_select_authenticated rewritten (audience visibility)
--   4. event_audience_users policies rewritten (4: select/insert/
--      update/delete)
--   MANUAL CHECKLIST

-- ---------------------------------------------------------
-- 1. is_event_creator(uuid) — SECURITY DEFINER
-- ---------------------------------------------------------
-- "Is the caller the creator of this event?" The four
-- event_audience_users policies of 0050 answered this with an inline
-- exists (...) over umsuka.events, which re-entered the FORCE-RLS'd
-- events policies and fed the recursion. As a SECURITY DEFINER
-- function it runs as the owner (postgres) and never re-enters RLS.
create or replace function umsuka.is_event_creator(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select exists(
    select 1 from umsuka.events e
    where e.id = p_event_id
      and e.created_by = auth.uid()
  );
$$;

comment on function umsuka.is_event_creator(uuid) is
  'Returns true if the currently authenticated user created the given event. SECURITY DEFINER so RLS policies can call it without re-entering the policy machinery (breaks the events <-> event_audience_users recursion fixed in migration 0055).';

grant execute on function umsuka.is_event_creator(uuid) to authenticated;

-- ---------------------------------------------------------
-- 2. is_event_audience_member(uuid) — SECURITY DEFINER
-- ---------------------------------------------------------
-- "Is the caller part of this event's concrete audience?" The
-- events_select_authenticated policy of 0050 answered this with an
-- inline exists (...) over umsuka.event_audience_users, which
-- re-entered the FORCE-RLS'd event_audience_users policies and fed
-- the recursion. Same SECURITY DEFINER rationale as section 1.
create or replace function umsuka.is_event_audience_member(p_event_id uuid)
returns boolean
language sql
stable
security definer
set search_path = umsuka, public
as $$
  select exists(
    select 1 from umsuka.event_audience_users eau
    where eau.event_id = p_event_id
      and eau.user_id = auth.uid()
  );
$$;

comment on function umsuka.is_event_audience_member(uuid) is
  'Returns true if the currently authenticated user belongs to the concrete audience (umsuka.event_audience_users) of the given event. SECURITY DEFINER so RLS policies can call it without re-entering the policy machinery (breaks the events <-> event_audience_users recursion fixed in migration 0055).';

grant execute on function umsuka.is_event_audience_member(uuid) to authenticated;

-- ---------------------------------------------------------
-- 3. events SELECT policy — audience visibility (rewritten)
-- ---------------------------------------------------------
-- Same conditions and ordering as section 8 of 0050: management sees
-- everything; otherwise BOTH the legacy visible_to_group rule AND the
-- audience rule must match (all / caller's workgroup / caller's
-- component / membership in event_audience_users). The final audience
-- clause now calls umsuka.is_event_audience_member(umsuka.events.id)
-- instead of the inline exists (...) — no RLS re-entrance.
drop policy if exists "events_select_authenticated" on umsuka.events;
create policy "events_select_authenticated"
  on umsuka.events for select
  to authenticated
  using (
    umsuka.is_management()
    or (
      (
        visible_to_group is null
        or visible_to_group::text = umsuka.current_user_workgroup()::text
      )
      and (
        audience_type = 'all'
        or (audience_type = 'workgroup' and audience_workgroup = umsuka.current_user_workgroup()::text)
        or (audience_type = 'member_type' and audience_member_type = umsuka.current_user_component()::text)
        or umsuka.is_event_audience_member(umsuka.events.id)
      )
    )
  );

-- ---------------------------------------------------------
-- 4. event_audience_users policies (rewritten)
-- ---------------------------------------------------------
-- Semantics preserved 1:1 from section 7 of 0050: SELECT = own row OR
-- management OR event creator; INSERT/UPDATE/DELETE = management OR
-- event creator. Every inline exists (...) over umsuka.events becomes
-- umsuka.is_event_creator(event_id) (SECURITY DEFINER — the events
-- policies are never re-entered, recursion broken at this end too).
drop policy if exists "event_audience_users_select_own_or_management_or_creator" on umsuka.event_audience_users;
create policy "event_audience_users_select_own_or_management_or_creator"
  on umsuka.event_audience_users for select
  to authenticated
  using (
    user_id = auth.uid()
    or umsuka.is_management()
    or umsuka.is_event_creator(event_id)
  );

drop policy if exists "event_audience_users_insert_management_or_creator" on umsuka.event_audience_users;
create policy "event_audience_users_insert_management_or_creator"
  on umsuka.event_audience_users for insert
  to authenticated
  with check (
    umsuka.is_management()
    or umsuka.is_event_creator(event_id)
  );

drop policy if exists "event_audience_users_update_management_or_creator" on umsuka.event_audience_users;
create policy "event_audience_users_update_management_or_creator"
  on umsuka.event_audience_users for update
  to authenticated
  using (
    umsuka.is_management()
    or umsuka.is_event_creator(event_id)
  )
  with check (
    umsuka.is_management()
    or umsuka.is_event_creator(event_id)
  );

drop policy if exists "event_audience_users_delete_management_or_creator" on umsuka.event_audience_users;
create policy "event_audience_users_delete_management_or_creator"
  on umsuka.event_audience_users for delete
  to authenticated
  using (
    umsuka.is_management()
    or umsuka.is_event_creator(event_id)
  );

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (no Supabase local/CLI in this environment; SQL is
-- hand-reasoned — pattern of the previous sprints). Verify before deploy:
--
-- [ ] umsuka.is_event_creator(uuid) and
--       umsuka.is_event_audience_member(uuid) exist with language sql /
--       stable / security definer / set search_path = umsuka, public,
--       and are granted to authenticated.
-- [ ] No inline `exists (select ... from umsuka.events ...)` remains in
--       any event_audience_users policy — all four use
--       umsuka.is_event_creator(event_id).
-- [ ] No inline `exists (select ... from umsuka.event_audience_users ...)`
--       remains in events_select_authenticated — it uses
--       umsuka.is_event_audience_member(umsuka.events.id).
-- [ ] Each rewritten policy exists exactly once after deploy
--       (drop policy if exists ran before its create).
-- [ ] An authenticated non-management user can run
--       select * from umsuka.events without
--       'infinite recursion detected in policy for relation "events"'
--       and sees the same rows as before 0055 for audience types
--       all / workgroup / member_type / specific_users (visibility
--       contract of 0050 preserved).
-- [ ] The event creator can still insert/update/delete rows of
--       umsuka.event_audience_users for their own events; management
--       can for any event; a plain member only ever sees their own rows.
-- [ ] supabase db push applies the migration; re-running it is
--       idempotent (create or replace function + drop policy if exists).
-- ---------------------------------------------------------