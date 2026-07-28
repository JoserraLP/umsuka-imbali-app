# ADR-005: Sprint 5 — Asistencia y Ausencias (Attendance and Absences)

**Status:** Accepted · **Date:** 2026-07-28

---

## Context

Sprint 5 implements attendance tracking and absence management for event
participants. Before this sprint, the event detail page (`/events/[id]`) showed
event details and a registration panel but had no way to record who attended or
to handle members who could not attend.

The database schema already contained two tables under the `umsuka` schema:

- **`umsuka.attendance`** — stores a boolean `attended` per user per event,
  with a unique constraint on `(event_id, user_id)`.
- **`umsuka.absences`** — stores an optional `reason` text and a `justified`
  boolean per user per event.

RLS policies were already in place covering these tables (see DATABASE.md for
the baseline policy matrix). Both tables have foreign-key relationships to
`auth.users` (via `user_id`) and `umsuka.events` (via `event_id`), but **no
direct foreign keys to `umsuka.profiles`** — instead, both reference
`auth.users` independently. This design choice, established before this sprint,
means that joining attendance or absence records with profile names requires
the same "two-query + in-memory-join" pattern already used by the registrations
module (see `src/lib/registrations/queries.ts`).

The project follows a consistent 3-layer pattern for every business module:

1. **Schema** (Zod) — input validation and type inference in `src/lib/<module>/schema.ts`.
2. **Queries & Mutations** — server-side data access functions in
   `src/lib/<module>/queries.ts` and `src/lib/<module>/mutations.ts`.
3. **Server Actions** — thin `"use server"` wrappers in
   `src/app/events/[id]/<module>-actions.ts` that call mutations and revalidate
   on success.

Client components (panels) consume these actions via `useTransition` and call
`router.refresh()` after success.

Architecture, database, and deployment context are documented in
`docs/ARCHITECTURE.md` and `docs/DATABASE.md`.

---

## Decision

### Attendance module (`src/lib/attendance/`)

**Schemas** (`schema.ts`):

| Schema | Fields | Purpose |
|---|---|---|
| `markAttendanceSchema` | `eventId: uuid`, `userId: uuid`, `attended: boolean` | Mark a single member present/absent |
| `markMultipleAttendanceSchema` | `records: markAttendanceSchema[]` (min 1) | Batch mark for multiple members |
| `updateAttendanceSchema` | `id: uuid`, `attended: boolean` | Update an existing record by PK |
| `deleteAttendanceSchema` | `id: uuid` | Remove an attendance record |

**Queries** (`queries.ts`):

| Function | Returns | Pattern |
|---|---|---|
| `getEventAttendance(eventId)` | `AttendanceRecord[]` (with `firstName`, `lastName`) | Two-query: attendance rows → fetch matching profiles → join in memory |
| `getUserAttendance(userId)` | `UserAttendanceRecord[]` (with `eventTitle`, `eventDate`) | Two-query: user's attendance rows → fetch matching events → join in memory |
| `getEventAttendanceSummary(eventId)` | `AttendanceSummary { present, absent, total }` | Single query counting `attended` values |

**Mutations** (`mutations.ts`):

All attendance mutations enforce the management role via
`requireManagement(actor.role)` before proceeding. The helper
`assertCanManageAttendance()` calls `requireAuthenticatedProfile()` and then
`requireManagement()`, returning either the `AuthenticatedProfile` on success
or a `MutationResult` on authorization failure.

- `markAttendance()` — upserts into `attendance` using the
  `(event_id, user_id)` conflict target.
- `markMultipleAttendance()` — iterates each record and calls `markAttendance`
  logic individually (Supabase JS client does not support batch upsert with
  conflict targeting).
- `updateAttendance()` — updates the `attended` column by primary key `id`.
- `deleteAttendance()` — deletes by primary key `id`.

### Absences module (`src/lib/absences/`)

**Schemas** (`schema.ts`):

| Schema | Fields | Purpose |
|---|---|---|
| `requestAbsenceSchema` | `eventId: uuid`, `reason: string` (trimmed, 1–500 chars) | Member requests an absence |
| `justifyAbsenceSchema` | `absenceId: uuid`, `justified: boolean` | Management approves/rejects |
| `deleteAbsenceSchema` | `absenceId: uuid` | Management deletes a record |

**Queries** (`queries.ts`):

| Function | Returns | Pattern |
|---|---|---|
| `getEventAbsences(eventId)` | `AbsenceRecord[]` (with `firstName`, `lastName`) | Two-query with `resolveProfiles()` helper |
| `getUserAbsences(userId)` | `UserAbsenceRecord[]` (with `eventTitle`, `eventDate`) | Two-query: user's absence rows → fetch events → join in memory |
| `getPendingAbsences()` | `AbsenceRecord[]` (unjustified only) | Two-query filtered by `justified = false` |

**Mutations** (`mutations.ts`):

- `requestAbsence()` — inserts a new absence using `actor.id` from the
  authenticated session (never from client input), **preventing impersonation**.
  This function does **not** require management role — any authenticated member
  can request an absence. RLS enforces the same rule at the database level.
- `justifyAbsence()` — updates the `justified` column. Management only.
- `deleteAbsence()` — deletes by absence `id`. Management only.

### Server Actions

**`attendance-actions.ts`** (colocated in `src/app/events/[id]/`):

| Action | Delegates to | Revalidates |
|---|---|---|
| `markAttendanceAction` | `markAttendance()` | `/events/${eventId}` |
| `markMultipleAttendanceAction` | `markMultipleAttendance()` | `/events/${eventId}` |
| `updateAttendanceAction` | `updateAttendance()` | `/events/[id]` (page pattern) |
| `deleteAttendanceAction` | `deleteAttendance()` | `/events/[id]` (page pattern) |

**`absence-actions.ts`** (colocated in `src/app/events/[id]/`):

| Action | Delegates to | Revalidates |
|---|---|---|
| `requestAbsenceAction` | `requestAbsence()` | `/events/${eventId}` |
| `justifyAbsenceAction` | `justifyAbsence()` | `/events/[id]` (page pattern) |
| `deleteAbsenceAction` | `deleteAbsence()` | `/events/[id]` (page pattern) |

Actions are thin wrappers: they validate input by delegating to the mutation
(which itself validates via Zod), and call `revalidatePath()` only when the
mutation returns `success: true`.

### UI Panels

**`AttendancePanel`** (`attendance-panel.tsx`) — a `"use client"` component
rendered **only for management roles** on the event detail page. It receives
the list of registered attendees (from the registration module's summary),
displays a toggle button per attendee to flip between "Presente" / "Ausente",
and shows aggregate counts (present, absent, unchecked). The component uses
`useTransition` for pending state and `router.refresh()` on success.

**`AbsencePanel`** (`absence-panel.tsx`) — a `"use client"` component rendered
for **all authenticated users** on the event detail page. It has two sections:

1. **Request absence** — visible to any member who has not yet requested an
   absence for the event. A text input (max 500 chars) and submit button.
2. **Management section** — visible only when `canManage` is true. Lists
   pending absences with "Justificar" / "No justificar" / "Eliminar" actions,
   and already-justified absences with an "Eliminar" action.

The viewer can see the status of their own request ("Justificada" or "Pendiente
de revisión") even without management privileges.

### History Page

**`/profile/history`** (`src/app/profile/history/page.tsx`) — a server component
that fetches both `getUserAttendance(profile.id)` and
`getUserAbsences(profile.id)` in parallel via `Promise.all()`, and renders two
tables:

| Column | Attendance | Absences |
|---|---|---|
| Evento | Link to `/events/[id]` | Link to `/events/[id]` |
| Fecha del evento | Formatted with `es-ES` locale | Formatted with `es-ES` locale |
| Asistió | Badge "Sí"/"No" | — |
| Motivo | — | Truncated text (max 200px) |
| Justificada | — | Badge "Sí"/"No" |

All user-facing strings are in Spanish.

### Security & Authorization

- Attendance mutations (mark, update, delete) all gate on management roles via
  `requireManagement()`.
- Absence requests use `actor.id` from the session — the Zod schema does not
  accept a `userId` field, so impersonation is structurally impossible.
- Absence justification and deletion require management role.
- RLS provides defense in depth at the database level (see DATABASE.md).

### Two-query + in-memory-join pattern

Both `attendance/queries.ts` and `absences/queries.ts` use the same pattern
established by `registrations/queries.ts`:

1. Query the target table (attendance or absences) for the records.
2. Collect all referenced `user_id` or `event_id` values.
3. Issue a second query to `umsuka.profiles` or `umsuka.events` with `IN (...)`.
4. Join in memory using a `Map`.

This pattern exists because there are no direct foreign keys between these
tables and `umsuka.profiles` (both reference `auth.users` independently).
Function signatures return camelCase objects with joined fields flattened
(e.g., `firstName`, `lastName`, `eventTitle`).

### Test Coverage

29 new unit tests were added, all validating Zod schema parsing:

| Test file | Tests | Schemas covered |
|---|---|---|
| `tests/unit/lib/attendance-schema.test.ts` | 15 | `markAttendanceSchema` (6), `markMultipleAttendanceSchema` (4), `updateAttendanceSchema` (3), `deleteAttendanceSchema` (2) |
| `tests/unit/lib/absences-schema.test.ts` | 14 | `requestAbsenceSchema` (7), `justifyAbsenceSchema` (5), `deleteAbsenceSchema` (2) |

No HIGH findings were reported by the security scan.

---

## Consequences

### Positive

- **Management can now mark present/absent** per attendee via the event detail
  page, with aggregate counts displayed in real time.
- **Members can request justified absences** with a reason text (max 500 chars,
  trimmed). Only one absence request per event per user is allowed (enforced by
  the UI showing "Ya has solicitado ausencia" and by RLS/unique constraints).
- **Management can approve (justify) or reject** absence requests, with a clear
  audit trail (`justified` boolean + `created_at` timestamp).
- **Each member can view their own attendance/absence history** at
  `/profile/history` with links to the relevant events.
- **The navigation was updated** with a "Historial" link accessible to all
  authenticated users via `DashboardNav`.
- **The 3-layer pattern is preserved** — Zod schemas validate input, mutations
  enforce authorization and perform DB operations, server actions handle
  revalidation, and client components manage UI state.
- **Impersonation is structurally prevented** — absence requests use
  `actor.id` exclusively; the Zod schema does not accept a `userId` field.
- **29 new unit tests** validate schema-level constraints (UUID format,
  required fields, string length limits, boolean types).
- **Security scan passed** with no HIGH findings.

### Negative

- **No email/push notification** is sent when a member requests an absence or
  when management justifies one. Management must manually check the event page.
- **The AttendancePanel requires the attendee list from the registration
  module** — it cannot operate independently. If a member is not registered,
  they cannot be marked present/absent via this panel.
- **`markMultipleAttendance` issues one upsert per record** (no batch upsert),
  which could be slow for very large events. This is an acknowledged limitation
  of the Supabase JS client.
- **The two-query pattern** requires two network round-trips per query, though
  the impact is minimal given the expected data volume.

### Neutral

- **All user-facing strings are in Spanish**, consistent with the rest of the
  application.
- **The history page is a server component** — no client-state management is
  needed; data is fetched and rendered on every navigation (no stale data risk,
  but also no offline caching).
- **The `resolveProfiles` helper in `absences/queries.ts`** is a private
  function extracted to avoid duplicating the two-query + join logic across
  `getEventAbsences()` and `getPendingAbsences()`.

---

## File Manifest

### New files

| File | Purpose |
|---|---|
| `src/lib/attendance/schema.ts` | Zod schemas and TypeScript types for attendance operations |
| `src/lib/attendance/queries.ts` | `getEventAttendance`, `getUserAttendance`, `getEventAttendanceSummary` |
| `src/lib/attendance/mutations.ts` | `markAttendance`, `markMultipleAttendance`, `updateAttendance`, `deleteAttendance` |
| `src/lib/absences/schema.ts` | Zod schemas and TypeScript types for absence operations |
| `src/lib/absences/queries.ts` | `getEventAbsences`, `getUserAbsences`, `getPendingAbsences` |
| `src/lib/absences/mutations.ts` | `requestAbsence`, `justifyAbsence`, `deleteAbsence` |
| `src/app/events/[id]/attendance-actions.ts` | Server action wrappers for attendance mutations |
| `src/app/events/[id]/absence-actions.ts` | Server action wrappers for absence mutations |
| `src/app/events/[id]/attendance-panel.tsx` | `"use client"` component for management attendance toggles |
| `src/app/events/[id]/absence-panel.tsx` | `"use client"` component for absence request and management |
| `src/app/profile/history/page.tsx` | Server component showing the current user's attendance and absence history |
| `tests/unit/lib/attendance-schema.test.ts` | 15 unit tests for attendance Zod schemas |
| `tests/unit/lib/absences-schema.test.ts` | 14 unit tests for absence Zod schemas |

### Modified files

| File | Change |
|---|---|
| `src/app/events/[id]/page.tsx` | Added `AttendancePanel` card (management-only) and `AbsencePanel` card (all authenticated users) to the event detail layout; fetches `getEventAttendance`, `getEventAttendanceSummary`, and `getEventAbsences` |
| `src/components/layout/dashboard-nav.tsx` | Added `{ href: "/profile/history", label: "Historial" }` navigation link |
