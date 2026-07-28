# ADR-002: Sprint 2 — Roles de Responsables de Grupos de Trabajo (Workgroup Lead Roles)

**Status:** Accepted · **Date:** 2026-07-28

---

## Context

Sprint 2 implements workgroup-specific roles for managing attendance at event
shifts. The Umsuka Imbali App organises its membership around four functional
workgroups, each responsible for a different area during events:

| Workgroup | Spanish | Responsibility |
|---|---|---|
| `telas` | Telas | Fabrics / textiles |
| `barra` | Barra | Bar service |
| `estandarte` | Estandarte | Banner / standard |
| `limpieza` | Limpieza | Cleaning |

Before this sprint, there was no concept of workgroups in the application.
All members were equal with respect to event attendance — only management
roles (`admin`, `super_admin`) could mark attendance through the existing
`AttendancePanel`, which tracks global event-level attendance (present/absent
per event).

Two gaps existed:

1. **No workgroup-level attendance** — attendance was tracked per event, not
   per shift per workgroup. A member assigned to "telas" who attended their
   shift could not be distinguished from a member who did not.
2. **No delegated responsibility** — only management roles could mark
   attendance. Workgroup leads (responsables) had no way to verify their own
   team's attendance without asking an admin.

The project follows a consistent 3-layer pattern for every business module:

1. **Schema** (Zod) — input validation and type inference in `src/lib/<module>/schema.ts`.
2. **Queries & Mutations** — server-side data access functions in
   `src/lib/<module>/queries.ts` and `src/lib/<module>/mutations.ts`.
3. **Server Actions** — thin `"use server"` wrappers colocated in
   `src/app/events/[id]/<module>-actions.ts` that call mutations and revalidate
   on success.

Client components (panels) consume these actions via `useTransition` and call
`router.refresh()` after success.

Architecture, database, and deployment context are documented in
`docs/ARCHITECTURE.md` and `docs/DATABASE.md`.

---

## Decision

### Database Layer — Dual-Column Approach on `umsuka.profiles`

Two new columns were added to the existing `umsuka.profiles` table (migration
0018 / file `20260101001700_workgroups_profiles.sql`):

| Column | Type | Default | Constraint | Purpose |
|---|---|---|---|---|
| `workgroup` | `text` | `'ninguno'` | `CHECK (workgroup IN ('telas', 'barra', 'estandarte', 'limpieza', 'ninguno'))` | Assigns a member to a workgroup |
| `is_workgroup_lead` | `boolean` | `false` | — | Designates a member as the lead of their assigned workgroup |

An index was created on `workgroup` for efficient filtering by group.

The value `'ninguno'` represents "no workgroup assignment" and is the default
for all existing and new profiles. Members with `workgroup = 'ninguno'` are
excluded from the workgroup attendance panel.

### Database Layer — `umsuka.workgroup_attendance` Table

A new table was created (migration 0019 / file `20260101001800_workgroup_attendance.sql`):

| Column | Type | Constraints | Purpose |
|---|---|---|---|
| `id` | `uuid` | `PK`, `default gen_random_uuid()` | Primary key |
| `shift_id` | `uuid` | `NOT NULL`, FK → `umsuka.shifts(id)` ON DELETE CASCADE | Shift being attended |
| `user_id` | `uuid` | `NOT NULL`, FK → `auth.users(id)` ON DELETE CASCADE | Member being tracked |
| `workgroup` | `text` | `NOT NULL` | Workgroup context for this attendance record |
| `attended` | `boolean` | `NOT NULL` | Whether the member attended |
| `marked_by` | `uuid` | FK → `auth.users(id)` | Who recorded the attendance |
| `created_at` | `timestamptz` | `default now()` | Timestamp of creation |
| `updated_at` | `timestamptz` | `default now()`, auto-updated via trigger | Timestamp of last update |

The unique constraint `UNIQUE (shift_id, user_id, workgroup)` ensures that a
member can have at most one attendance record per shift per workgroup. This
supports the upsert pattern used by the application layer.

Indexes are created on `shift_id`, `user_id`, and `workgroup` individually for
query performance.

A trigger `trg_workgroup_attendance_updated_at` calls
`umsuka.update_updated_at_column()` to automatically maintain the `updated_at`
timestamp.

### Database Layer — Helper Functions and RLS

Three SQL helper functions were created (migration 0020 / file
`20260101001900_workgroup_rls.sql`):

| Function | Returns | Purpose |
|---|---|---|
| `umsuka.is_workgroup_lead(check_workgroup text)` | `boolean` | True if the current `auth.uid()` is the lead of the given workgroup |
| `umsuka.current_user_workgroup()` | `text` | Returns the workgroup of the current authenticated user |
| `umsuka.is_super_admin()` | `boolean` | True if the current user has role `super_admin` (not `admin`) |

All three are `security definer` functions with `set search_path = umsuka, public`.

**RLS policies** on `umsuka.workgroup_attendance`:

| Operation | Policy | Allows when |
|---|---|---|
| `SELECT` | `workgroup_attendance_select` | User is the subject (`user_id = auth.uid()`) OR is workgroup lead for the record's workgroup OR is super_admin |
| `INSERT` | `workgroup_attendance_insert` | Is workgroup lead for the workgroup OR is super_admin |
| `UPDATE` | `workgroup_attendance_update` | Is workgroup lead OR is super_admin (checked on both `USING` and `WITH CHECK`) |
| `DELETE` | `workgroup_attendance_delete` | Is workgroup lead OR is super_admin |

RLS is both enabled and forced on the table (`ENABLE ROW LEVEL SECURITY` +
`FORCE ROW LEVEL SECURITY`).

### Application Layer — `src/lib/workgroups/schema.ts`

| Schema / Type | Fields | Purpose |
|---|---|---|
| `markWorkgroupAttendanceSchema` | `shiftId: uuid`, `userId: uuid`, `workgroup: activeWorkgroupSchema`, `attended: boolean` | Mark attendance for a member on a shift within a workgroup |
| `updateWorkgroupAttendanceSchema` | `id: uuid`, `attended: boolean` | Update existing record by PK |
| `WorkgroupLeadInfo` | `isLead: boolean`, `workgroup: ActiveWorkgroup \| null` | Lead status query result type |
| `WorkgroupAttendanceRecord` | `id`, `shiftId`, `userId`, `workgroup`, `attended`, `markedBy`, `createdAt`, `updatedAt`, `firstName`, `lastName` | Enriched record with profile names |
| `WorkgroupAttendanceSummary` | `workgroup: ActiveWorkgroup`, `present`, `absent`, `unchecked` | Per-workgroup counts |

Constants:
- `WORKGROUPS` — all five values including `'ninguno'`
- `ACTIVE_WORKGROUPS` — only `'telas'`, `'barra'`, `'estandarte'`, `'limpieza'`
- `activeWorkgroupSchema` — Zod enum of `ACTIVE_WORKGROUPS`

### Application Layer — `src/lib/workgroups/queries.ts`

| Function | Returns | Pattern |
|---|---|---|
| `getWorkgroupAttendanceByShift(shiftId)` | `WorkgroupAttendanceRecord[]` | Two-query: attendance rows → fetch matching profiles → join in memory via `Map` |
| `getAllWorkgroupMembers()` | `{ userId, firstName, lastName, workgroup }[]` | Single query to `profiles` filtered by `workgroup != 'ninguno'`, ordered by workgroup then first name |
| `getCurrentUserWorkgroupLeadStatus()` | `WorkgroupLeadInfo` | Reads `isWorkgroupLead` and `workgroup` from `requireAuthenticatedProfile()` |
| `getWorkgroupAttendanceSummary(shiftId)` | `WorkgroupAttendanceSummary[]` | Fetches attendance records per shift, aggregates counts per workgroup in memory |

### Application Layer — `src/lib/workgroups/mutations.ts`

**Authorization guard** — `assertCanManageWorkgroup(workgroup, actor)`:

1. If `actor.role === "super_admin"` → allow (bypasses group-specific checks).
2. If `actor.isWorkgroupLead` is false → throws `AuthorizationError`.
3. If `actor.workgroup !== workgroup` → throws `AuthorizationError` (cannot
   manage a group that is not your own).

| Mutation | Schema | Auth guard | DB operation |
|---|---|---|---|
| `markWorkgroupAttendance(input)` | `markWorkgroupAttendanceSchema` | `assertCanManageWorkgroup(data.workgroup, actor)` | `upsert` on conflict `(shift_id, user_id, workgroup)`, sets `marked_by` to actor's ID |
| `updateWorkgroupAttendance(input)` | `updateWorkgroupAttendanceSchema` | Fetches record first, then `assertCanManageWorkgroup(existing.workgroup, actor)` | `update` by PK `id`, also updates `marked_by` |

Both return `MutationResult { success: boolean; error?: string }`.

### Server Actions — `src/app/events/[id]/workgroup-actions.ts`

| Action | Delegates to | Revalidates |
|---|---|---|
| `markWorkgroupAttendanceAction(input)` | `markWorkgroupAttendance(input)` | `revalidatePath('/events/[id]', 'page')` |
| `updateWorkgroupAttendanceAction(input)` | `updateWorkgroupAttendance(input)` | `revalidatePath('/events/[id]', 'page')` |

### UI — `WorkgroupAttendancePanel` (`src/app/events/[id]/workgroup-panel.tsx`)

A `"use client"` component rendered **only when the current user is a
workgroup lead or super_admin AND the event has at least one shift**. It
receives:

- `shiftId` / `shiftName` — the first shift of the event (the panel
  currently renders for a single shift, the event's first)
- `members` — all profiles with a non-`ninguno` workgroup assignment
- `attendanceRecords` — existing attendance records for the shift
- `currentUserWorkgroup` / `isLead` / `isSuperAdmin` — session-derived props

The component:

1. Builds a `Map<userId:workgroup, attended>` lookup from `attendanceRecords`.
2. Groups members into the four active workgroups.
3. Determines manageable workgroups: **all four** if super_admin, **only
   the user's own** if workgroup lead.
4. Shows aggregate badges per workgroup (presentes, ausentes, sin marcar).
5. Renders a `Card` per workgroup with member rows. Each row shows a
   "Presente" / "Ausente" / "Sin marcar" badge and, if the user can manage
   that workgroup, a toggle button ("Marcar presente" / "Marcar ausente").
6. Toggle calls `markWorkgroupAttendanceAction` via `useTransition` and
   calls `router.refresh()` on success.
7. Shows an error banner on failure. Renders an empty-state message when no
   members have workgroup assignments.

### Integration — Event Page (`src/app/events/[id]/page.tsx`)

The event detail page was extended with a new card **"Asistencia por grupo de
trabajo"** positioned between the attendance panel and the absence panel:

```tsx
{canViewWorkgroupPanel && firstShift && (
  <Card>
    <CardHeader>
      <CardTitle>Asistencia por grupo de trabajo</CardTitle>
      <CardDescription>
        Marca quién asistió a su grupo de trabajo en el turno &laquo;
        {firstShift.name}&raquo;.
      </CardDescription>
    </CardHeader>
    <CardContent>
      <WorkgroupAttendancePanel
        shiftId={firstShift.id}
        shiftName={firstShift.name}
        members={workgroupMembers}
        attendanceRecords={workgroupAttendanceRecords}
        currentUserWorkgroup={profile.workgroup}
        isLead={profile.isWorkgroupLead}
        isSuperAdmin={profile.role === "super_admin"}
      />
    </CardContent>
  </Card>
)}
```

The visibility guard (`canViewWorkgroupPanel`) is:
```
profile.role === "super_admin" || profile.isWorkgroupLead
```

Data is only fetched when the panel will render:
```tsx
if (canViewWorkgroupPanel && firstShift) {
  [workgroupMembers, workgroupAttendanceRecords] = await Promise.all([
    getAllWorkgroupMembers(),
    getWorkgroupAttendanceByShift(firstShift.id),
  ]);
}
```

### Type & Session Changes

**`src/types/auth.ts`** — `AuthenticatedProfile` gained two fields:

```typescript
workgroup: Workgroup;
isWorkgroupLead: boolean;
```

**`src/lib/auth/session.ts`** — The profile fetching query now includes
`workgroup` and `is_workgroup_lead` columns (mapped from snake_case to
camelCase).

**`src/types/database.types.ts`** — The `Workgroup` enum type and
`workgroup_attendance` table row types were added to match the new schema.

### Security Model — Defense in Depth

1. **UI layer**: Toggle buttons only render for workgroups the current user
   can manage (checked via `canManageWorkgroup()` in the panel component).
2. **Application layer**: `assertCanManageWorkgroup()` in `mutations.ts`
   checks the actor's role and workgroup before any database operation.
3. **Database layer**: RLS policies on `umsuka.workgroup_attendance` use
   `umsuka.is_workgroup_lead(workgroup)` and `umsuka.is_super_admin()` to
   enforce authorization at the row level.
4. **Super admin bypass**: `super_admin` can manage all workgroups at every
   layer without needing to be assigned as a lead.

The `updateWorkgroupAttendance` mutation adds an extra safety check: it
fetches the existing record first to determine the workgroup context, then
calls `assertCanManageWorkgroup()` with that workgroup. This prevents a
malicious actor from updating a workgroup attendance record for a group they
do not manage by guessing a primary key UUID.

### Test Coverage

19 new unit tests were added in `tests/unit/lib/workgroups-schema.test.ts`:

| Schema | Tests | Coverage |
|---|---|---|
| `markWorkgroupAttendanceSchema` | 13 | Valid inputs (all 4 workgroups), invalid workgroup, `ninguno` rejection, invalid/missing UUIDs for shiftId/userId, missing fields, non-boolean `attended` |
| `updateWorkgroupAttendanceSchema` | 6 | Valid input, `attended=false`, invalid/missing `id`, missing `attended`, non-boolean `attended` |

---

## Consequences

### Positive

- **Workgroup leads can mark attendance** exclusively for members of their
  own workgroup, solving the original delegation gap.
- **Super admin retains full visibility** and can manage all four workgroups
  from a single panel, bypassing group-specific checks.
- **Dual-column approach is schema-light** — two columns on an existing table
  rather than a separate roles table, keeping the schema simple while the
  feature is new.
- **Defense in depth** — three independent authorization layers (UI,
  application, database) prevent unauthorized attendance marking.
- **Upsert pattern prevents duplicates** — the unique constraint on
  `(shift_id, user_id, workgroup)` allows the mutation to be safely retried
  without creating duplicate records.
- **The two-query + in-memory-join pattern** (established in previous sprints)
  is reused for `getWorkgroupAttendanceByShift()`, maintaining consistency
  across the codebase.
- **19 new unit tests** validate schema-level constraints.
- **Members without workgroup assignment** (`ninguno`) are cleanly excluded
  from the panel — they never appear in `getAllWorkgroupMembers()`.

### Negative

- **The panel currently renders for only the first shift** of an event. If an
  event has multiple shifts, only the first shift's workgroup attendance is
  shown. This is an acknowledged scope limitation.
- **No per-row loading states** — the entire panel uses a single
  `isPending` flag from `useTransition`. When toggling one member, all
  toggle buttons show "..." until the action completes.
- **The `unchecked` count in `getWorkgroupAttendanceSummary` is hardcoded to
  `0`** — computing true unchecked counts would require the full membership
  list per workgroup, which the summary function does not currently have
  access to.
- **`getAllWorkgroupMembers()` returns all non-ninguno members** regardless of
  event registration. A member assigned to "telas" who did not register for
  the event will still appear in the panel. This is by design (workgroup
  attendance is orthogonal to event registration) but may cause confusion.

### Neutral

- **All user-facing strings are in Spanish**, consistent with the rest of the
  application.
- **The migration numbering has an internal offset** — the migration file
  names (`20260101001700`, `20260101001800`, `20260101001900`) lag the
  comments inside them (`0018`, `0019`, `0020`) by one. This is a cosmetic
  inconsistency inherited from the file-naming convention.
- **The `update_updated_at_column` function** was defined locally in migration
  0019 rather than reused from an existing function. This is consistent with
  the project's other migration files.

---

## File Manifest

### New files

| File | Purpose |
|---|---|
| `supabase/migrations/20260101001700_workgroups_profiles.sql` | Migration 0018: adds `workgroup` and `is_workgroup_lead` columns to `umsuka.profiles` |
| `supabase/migrations/20260101001800_workgroup_attendance.sql` | Migration 0019: creates `umsuka.workgroup_attendance` table with unique constraint and trigger |
| `supabase/migrations/20260101001900_workgroup_rls.sql` | Migration 0020: creates `is_workgroup_lead()`, `current_user_workgroup()`, `is_super_admin()` functions and RLS policies |
| `src/lib/workgroups/schema.ts` | Zod schemas (`markWorkgroupAttendanceSchema`, `updateWorkgroupAttendanceSchema`), TypeScript types, workgroup constants |
| `src/lib/workgroups/queries.ts` | `getWorkgroupAttendanceByShift`, `getAllWorkgroupMembers`, `getCurrentUserWorkgroupLeadStatus`, `getWorkgroupAttendanceSummary` |
| `src/lib/workgroups/mutations.ts` | `markWorkgroupAttendance`, `updateWorkgroupAttendance`, `assertCanManageWorkgroup` authorization guard |
| `src/app/events/[id]/workgroup-actions.ts` | Server action wrappers: `markWorkgroupAttendanceAction`, `updateWorkgroupAttendanceAction` |
| `src/app/events/[id]/workgroup-panel.tsx` | `"use client"` `WorkgroupAttendancePanel` component with toggle buttons per workgroup per member |
| `tests/unit/lib/workgroups-schema.test.ts` | 19 unit tests for workgroup attendance Zod schemas |

### Modified files

| File | Change |
|---|---|
| `src/types/auth.ts` | Added `workgroup: Workgroup` and `isWorkgroupLead: boolean` to `AuthenticatedProfile` |
| `src/types/database.types.ts` | Added `Workgroup` enum type, `is_workgroup_lead` and `workgroup` columns to profile types, `workgroup_attendance` table row types |
| `src/lib/auth/session.ts` | Extended profile fetch query to include `workgroup` and `is_workgroup_lead` columns; maps them to camelCase |
| `src/app/events/[id]/page.tsx` | Added workgroup visibility guard, data fetching, and `WorkgroupAttendancePanel` card between attendance and absence panels |
