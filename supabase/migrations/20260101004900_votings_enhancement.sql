-- =========================================================
-- UMSUKA IMBALI APP — 0049: votings enhancement (Sprint 15)
-- =========================================================
-- Adds an optional voting deadline, a case-insensitive unique index on
-- voting options within a voting, and a SECURITY DEFINER function that
-- computes per-option results (counts + percentages) while hiding them
-- from members who have not voted yet (or until the voting closes).
-- Mirrors the app-layer rule in src/lib/votings/logic.ts.

-- ---------------------------------------------------------
-- 1. Optional voting deadline
-- ---------------------------------------------------------
alter table umsuka.votings
    add column voting_deadline timestamptz;

comment on column umsuka.votings.voting_deadline is
    'Optional deadline. While set and in the future the voting stays effectively open; once it passes, the voting behaves as closed (no new votes, results visible).';

-- ---------------------------------------------------------
-- 2. Case-insensitive unique options per voting
-- ---------------------------------------------------------
create unique index idx_voting_options_voting_text_unique
    on umsuka.voting_options (voting_id, lower(option_text));

-- ---------------------------------------------------------
-- 3. Results function (SECURITY DEFINER)
-- ---------------------------------------------------------
-- Returns one row per option with vote counts, the total number of
-- votes and the percentage (one decimal). Results are hidden (empty
-- result set) while the voting is effectively open AND the caller has
-- not voted AND the caller is not management.
create or replace function umsuka.get_voting_results(p_voting_id uuid)
returns table (
    option_id uuid,
    option_text text,
    votes bigint,
    total_votes bigint,
    percentage numeric
)
language plpgsql
stable
security definer
set search_path = umsuka, public
as $$
declare
    v_voting umsuka.votings%rowtype;
    v_total bigint;
    v_has_voted boolean;
begin
    select * into v_voting
    from umsuka.votings
    where id = p_voting_id;

    if not found then
        return;
    end if;

    select count(*) into v_total
    from umsuka.voting_votes
    where voting_id = p_voting_id;

    select exists (
        select 1
        from umsuka.voting_votes
        where voting_id = p_voting_id
          and user_id = auth.uid()
    ) into v_has_voted;

    -- Hide results from members who have not voted yet while the
    -- voting is effectively open. Management always sees results.
    if v_voting.is_open
       and (v_voting.voting_deadline is null or v_voting.voting_deadline > now())
       and not v_has_voted
       and not umsuka.is_management() then
        return;
    end if;

    return query
    select
        o.id as option_id,
        o.option_text,
        count(v.id)::bigint as votes,
        v_total as total_votes,
        case
            when v_total > 0
                then round(count(v.id) * 100.0 / v_total, 1)
            else 0
        end as percentage
    from umsuka.voting_options o
    left join umsuka.voting_votes v on v.option_id = o.id
    where o.voting_id = p_voting_id
    group by o.id, o.option_text
    order by o.option_text asc;
end;
$$;

comment on function umsuka.get_voting_results(uuid) is
    'Per-option vote counts, totals and percentages for a voting. Results are hidden until the caller has voted, the deadline passes, or the voting is closed, unless the caller is management.';

grant execute on function umsuka.get_voting_results(uuid) to authenticated;

-- ---------------------------------------------------------
-- 4. voting_votes insert policy hardening (Sprint 15 QA)
-- ---------------------------------------------------------
-- The baseline policy only checked `user_id = auth.uid()`, which allowed
-- a direct PostgREST insert to reference an option belonging to ANOTHER
-- voting. Tighten it so the newly inserted row must reference an option
-- of the same voting. In the `with check` expression, the unqualified
-- `option_id` / `voting_id` refer to the NEW row's values.
drop policy if exists "voting_votes_insert_own" on umsuka.voting_votes;

create policy "voting_votes_insert_own"
  on umsuka.voting_votes for insert
  to authenticated
  with check (
    user_id = auth.uid()
    and exists (
      select 1 from umsuka.voting_options o
      where o.id = option_id
        and o.voting_id = voting_id
    )
  );

comment on policy "voting_votes_insert_own" on umsuka.voting_votes is
  'Members can only cast a vote for an option that belongs to the same voting (Sprint 15 QA).';