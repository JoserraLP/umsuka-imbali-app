# Database

All business data lives in the PostgreSQL schema **`umsuka`** (never
`public`). Authentication identities remain in Supabase's built-in
`auth.users`, referenced by foreign key from `umsuka.profiles.id`.

## Entity-relationship diagram

```mermaid
erDiagram
    PROFILES ||--o{ EVENTS : creates
    PROFILES ||--o{ NEWS : creates
    PROFILES ||--o{ QUESTIONS : asks
    PROFILES ||--o{ SHIFT_ASSIGNMENTS : assigned
    PROFILES ||--o{ ATTENDANCE : records
    PROFILES ||--o{ ABSENCES : requests
    PROFILES ||--o{ VOTING_VOTES : casts

    EVENTS ||--o{ SHIFTS : has
    EVENTS ||--o{ ATTENDANCE : tracks
    EVENTS ||--o{ ABSENCES : relates_to
    EVENTS ||--o{ VOTINGS : relates_to

    SHIFTS ||--o{ SHIFT_ASSIGNMENTS : staffed_by

    VOTINGS ||--o{ VOTING_OPTIONS : offers
    VOTINGS ||--o{ VOTING_VOTES : receives
    VOTING_OPTIONS ||--o{ VOTING_VOTES : chosen_in

    PROFILES {
        uuid id PK
        text first_name
        text last_name
        date birth_date
        text component_type
        text role
        timestamptz created_at
    }
    EVENTS {
        uuid id PK
        text title
        text description
        text event_type
        timestamptz event_date
        uuid created_by FK
    }
    SHIFTS {
        uuid id PK
        uuid event_id FK
        text name
        timestamptz start_time
        timestamptz end_time
    }
    SHIFT_ASSIGNMENTS {
        uuid id PK
        uuid shift_id FK
        uuid user_id FK
    }
    ATTENDANCE {
        uuid id PK
        uuid event_id FK
        uuid user_id FK
        boolean attended
    }
    ABSENCES {
        uuid id PK
        uuid user_id FK
        uuid event_id FK
        text reason
        boolean justified
    }
    NEWS {
        uuid id PK
        text title
        text content
        uuid created_by FK
    }
    QUESTIONS {
        uuid id PK
        uuid user_id FK
        text title
        text content
        boolean resolved
    }
    VOTINGS {
        uuid id PK
        text title
        text description
        uuid event_id FK
        boolean is_open
    }
    VOTING_OPTIONS {
        uuid id PK
        uuid voting_id FK
        text option_text
    }
    VOTING_VOTES {
        uuid id PK
        uuid voting_id FK
        uuid option_id FK
        uuid user_id FK
    }
```

## Migrations

| File | Purpose |
|---|---|
| `20260101000000_init_schema.sql` | Creates the `umsuka` schema, grants, `pgcrypto` extension |
| `20260101000100_profiles.sql` | `umsuka.profiles` |
| `20260101000200_events.sql` | `umsuka.events` |
| `20260101000300_shifts.sql` | `umsuka.shifts` |
| `20260101000400_shift_assignments.sql` | `umsuka.shift_assignments` |
| `20260101000500_attendance.sql` | `umsuka.attendance` |
| `20260101000600_absences.sql` | `umsuka.absences` |
| `20260101000700_news.sql` | `umsuka.news` |
| `20260101000800_questions.sql` | `umsuka.questions` |
| `20260101000900_votings.sql` | `umsuka.votings` |
| `20260101001000_voting_options.sql` | `umsuka.voting_options` |
| `20260101001100_voting_votes.sql` | `umsuka.voting_votes` |
| `20260101001200_auth_trigger.sql` | Additive `component_type` default + `handle_new_user()` trigger |
| `20260101001300_rls_policies.sql` | Helper functions + RLS policies for every table |
| `20260101004000_shift_assignment_groups.sql` | `shift_assignments.confirmed`/`created_by`, `events.visible_to_group`/`created_by_workgroup`, RLS de eventos y asignaciones por grupo |

Apply locally with `npm run supabase:reset`; apply to a remote project with
`supabase db push` (also run automatically by `deploy.yml` on merge to `main`).

## Schema-impacting decision log

> **Only two changes were made beyond the literal source-of-truth DDL, both
> additive and backwards-compatible:**

1. **`umsuka.profiles.component_type` gained `DEFAULT 'member'`.**
   The column remains `NOT NULL` with its original `CHECK` constraint
   unchanged. This was required so `umsuka.handle_new_user()` (the trigger
   that auto-creates a profile on first Google sign-in) has a valid value
   to insert before the member has chosen their actual component. No
   existing row is affected; the value can still be changed by the member
   or an admin at any time.
2. **Indexes added on every foreign-key column.** PostgreSQL does not
   auto-index foreign keys; without these, joins and RLS `using` clauses
   that filter by `user_id`/`event_id`/etc. would degrade to sequential
   scans as tables grow.

No table structure, column, type, or constraint from the official schema
was altered or removed.

## Row Level Security

RLS is **enabled and forced** on every `umsuka` table — there is no table
that a client can query without a matching policy. Two `SECURITY DEFINER`
helper functions avoid recursive-RLS problems when checking the caller's
role from within `umsuka.profiles` itself:

- `umsuka.current_user_role()` — returns the caller's role or `null`.
- `umsuka.is_admin()` — `true` for `super_admin`/`admin`.
- `umsuka.is_management()` — `true` for `super_admin`/`admin`/`board_member`/`event_manager`.

Baseline policy shape (tightened per-module as each is implemented, never
loosened):

| Table | Select | Insert / Update / Delete |
|---|---|---|
| `profiles` | any authenticated user | update: owner or admin · delete: admin · insert: trigger only |
| `events` | any authenticated user, **or restricted to `visible_to_group` members; management always** | management roles only · plus workgroup leads for their own `work_shift` events |
| `shifts`, `news`, `votings`, `voting_options` | any authenticated user | management roles only |
| `shift_assignments` | owner or management (plus leads of the shift's event) | management roles only · plus leads for shifts on their own `work_shift` events matching their group |
| `attendance` | owner or management | management roles only |
| `absences` | owner or management | insert: owner · update/delete: management |
| `questions` | any authenticated user | insert: owner · update: owner or management · delete: management |
| `voting_votes` | owner or management | insert: owner (immutable — no update policy) · delete: management |

## Extensibility

The following tables are pre-approved for future migrations when their
modules are implemented, and must follow the same pattern (indexes,
constraints, RLS, 3NF): `umsuka.documents`, `umsuka.document_categories`,
`umsuka.notifications`, `umsuka.settings`, `umsuka.audit_logs`,
`umsuka.event_registrations`, `umsuka.event_comments`,
`umsuka.push_subscriptions`, `umsuka.role_permissions`.
