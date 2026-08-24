import type { MemberListItem } from "@/lib/members/schema";
import type { InstrumentItem } from "@/lib/instruments/queries";
import type { EventListItem } from "@/lib/events/queries";
import type {
  EventSortField,
  InstrumentSortField,
  MemberSortField,
  SortDirection,
} from "@/lib/ordering/schema";

/**
 * Pure, dependency-free sorting engine (Sprint 25). Safe to import from
 * client and server code: the domain types above are erased at compile
 * time (`import type`), so no server module ends up in a client bundle.
 *
 * SPRINT 25 CONTRACT: sorting MUST run AFTER fetching/filtering a list
 * and BEFORE any slicing/pagination is applied, so every page renders a
 * consistently ordered set.
 */

export type SortableValue = string | number | null | undefined;

/**
 * Non-mutating multi-key sort. Returns a NEW array (the input is never
 * touched). Comparison rules:
 * - strings → locale-aware `es` collation, case- and accent-insensitive
 *   ("Álvaro" ≡ "alvaro"), digit sequences compared numerically
 *   ("Turno 2" < "Turno 10");
 * - numbers → numeric comparison (NaN counts as missing);
 * - null/undefined → ALWAYS last, in both directions;
 * - ties fall through to the next selector; the final tie-breaker is
 *   always `getId` ascending, so the output order is deterministic
 *   regardless of the input order or the sort algorithm's stability.
 */
export function applySorting<T>(
  items: readonly T[],
  selectors: ReadonlyArray<(item: T) => SortableValue>,
  direction: SortDirection,
  getId: (item: T) => string,
): T[] {
  const factor = direction === "desc" ? -1 : 1;

  return [...items].sort((a, b) => {
    for (const selector of selectors) {
      const rawA = selector(a);
      const rawB = selector(b);

      // NaN (e.g. Date.parse of a corrupt date) degrades to "missing".
      const valueA = typeof rawA === "number" && Number.isNaN(rawA) ? null : rawA;
      const valueB = typeof rawB === "number" && Number.isNaN(rawB) ? null : rawB;

      const aMissing = valueA === null || valueA === undefined;
      const bMissing = valueB === null || valueB === undefined;

      if (aMissing || bMissing) {
        if (aMissing && bMissing) continue; // both missing → next selector
        return aMissing ? 1 : -1; // missing values sink to the end
      }

      if (valueA !== valueB) {
        if (typeof valueA === "number" && typeof valueB === "number") {
          return (valueA - valueB) * factor;
        }
        return (
          String(valueA).localeCompare(String(valueB), "es", {
            sensitivity: "base",
            numeric: true,
          }) * factor
        );
      }
    }
    // Last tie-breaker: stable id ascending.
    return getId(a).localeCompare(getId(b), "es", { numeric: true });
  });
}

/** ISO timestamp → epoch millis, or null when unparseable/missing. */
function parseTimestamp(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const time = Date.parse(iso);
  return Number.isNaN(time) ? null : time;
}

// ── Per-list selectors ────────────────────────────────

const MEMBER_SELECTORS: Record<MemberSortField, (member: MemberListItem) => SortableValue> = {
  name: (member) => `${member.firstName} ${member.lastName}`,
  created_at: (member) => parseTimestamp(member.createdAt),
  workgroup: (member) => member.workgroup,
  component_type: (member) => member.componentType,
};

const INSTRUMENT_SELECTORS: Record<
  InstrumentSortField,
  (instrument: InstrumentItem) => SortableValue
> = {
  name: (instrument) => instrument.name,
  category: (instrument) => instrument.category,
  created_at: (instrument) => parseTimestamp(instrument.createdAt),
  assignee: (instrument) =>
    instrument.currentAssignee
      ? `${instrument.currentAssignee.firstName} ${instrument.currentAssignee.lastName}`
      : null,
};

const EVENT_SELECTORS: Record<EventSortField, (event: EventListItem) => SortableValue> = {
  event_date: (event) => parseTimestamp(event.eventDate),
  title: (event) => event.title,
  created_at: (event) => parseTimestamp(event.createdAt),
};

// ── Public per-list sorts ─────────────────────────────

export function sortMembers(
  items: readonly MemberListItem[],
  sortBy: MemberSortField,
  direction: SortDirection,
): MemberListItem[] {
  return applySorting(items, [MEMBER_SELECTORS[sortBy]], direction, (item) => item.id);
}

export function sortInstruments(
  items: readonly InstrumentItem[],
  sortBy: InstrumentSortField,
  direction: SortDirection,
): InstrumentItem[] {
  return applySorting(items, [INSTRUMENT_SELECTORS[sortBy]], direction, (item) => item.id);
}

export function sortEvents(
  items: readonly EventListItem[],
  sortBy: EventSortField,
  direction: SortDirection,
): EventListItem[] {
  return applySorting(items, [EVENT_SELECTORS[sortBy]], direction, (item) => item.id);
}
