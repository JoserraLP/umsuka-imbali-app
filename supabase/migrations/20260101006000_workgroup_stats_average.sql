-- =========================================================
-- UMSUKA IMBALI APP — 0060: workgroup shift average (Sprint 28)
-- =========================================================
-- SECURITY DEFINER function that returns the average of the PER-MEMBER
-- attendance rates of the caller's workgroup, used by /profile/stats to
-- compare a member's shift attendance against their group without
-- exposing any other member's rows (the caller only ever receives a
-- single aggregate number).
--
-- Design decisions:
--   1. The caller's workgroup is resolved from umsuka.profiles; members
--      without an active profile (deleted_at) or with 'ninguno' get NULL.
--   2. The average is computed over per-member rates (not over raw rows)
--      so a member with many marked shifts does not outweigh one with
--      few. Members of the group without any marked shift are ignored
--      (they have no rate yet); when nobody has marked shifts the
--      average is NULL.
--   3. SECURITY DEFINER is required because RLS on umsuka.profiles only
--      lets a member read their own row, yet the function must count
--      every member of the group. It aggregates and returns a single
--      number — no PII crosses the boundary. search_path is pinned to
--      prevent schema-qualified hijacking.

create or replace function umsuka.my_workgroup_shift_average()
returns numeric
language sql
stable
security definer
set search_path = umsuka, public
as $$
    with caller as (
        select p.workgroup
        from umsuka.profiles p
        where p.id = auth.uid()
          and p.deleted_at is null
          and p.workgroup <> 'ninguno'
    ),
    member_rates as (
        select
            a.user_id,
            100.0 * count(*) filter (where a.attended) / count(*) as rate
        from umsuka.workgroup_attendance a
        join umsuka.profiles m
            on m.id = a.user_id and m.deleted_at is null
        where a.workgroup = (select workgroup from caller)
        group by a.user_id
    )
    select round(avg(rate), 1)
    from member_rates
$$;

revoke execute on function umsuka.my_workgroup_shift_average() from public;
revoke execute on function umsuka.my_workgroup_shift_average() from anon;
grant execute on function umsuka.my_workgroup_shift_average() to authenticated;

comment on function umsuka.my_workgroup_shift_average() is
    'Average of the per-member shift-attendance rates of the caller''s workgroup (one decimal). Returns NULL for members without an active profile, members in no workgroup (''ninguno'') or groups where nobody has marked shifts yet. Aggregates only — never exposes other members'' rows.';

-- ---------------------------------------------------------
-- MANUAL CHECKLIST (no Supabase local/CLI in this environment; SQL is
-- hand-reasoned — pattern of the previous sprints). Verify before deploy:
--
-- [ ] A member of 'telas' with marked shifts gets a number equal to the
--       mean of the per-member rates of telas (one decimal).
-- [ ] A member whose profile has workgroup 'ninguno', or whose profile
--       is soft-deleted, gets NULL.
-- [ ] A group where nobody has marked shifts yields NULL.
-- [ ] anon/public callers are rejected (permission denied); only
--       authenticated may execute it.
-- [ ] re-running the migration is safe (create or replace + revoke/
--       grant are idempotent).
-- ---------------------------------------------------------
