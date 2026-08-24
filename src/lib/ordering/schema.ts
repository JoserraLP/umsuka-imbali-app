import { z } from "zod";

// ── Lists, directions and sort fields ─────────────────

export const LIST_IDS = ["members", "instruments", "events"] as const;
export type ListId = (typeof LIST_IDS)[number];

export const SORT_DIRECTIONS = ["asc", "desc"] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const MEMBER_SORT_FIELDS = ["name", "created_at", "workgroup", "component_type"] as const;
export const INSTRUMENT_SORT_FIELDS = ["name", "category", "created_at", "assignee"] as const;
export const EVENT_SORT_FIELDS = ["event_date", "title", "created_at"] as const;

export type MemberSortField = (typeof MEMBER_SORT_FIELDS)[number];
export type InstrumentSortField = (typeof INSTRUMENT_SORT_FIELDS)[number];
export type EventSortField = (typeof EVENT_SORT_FIELDS)[number];

/**
 * Cross-validation table used by the save mutation: a sort field is only
 * valid for the list it belongs to (e.g. `assignee` makes no sense for
 * /members). Kept in sync with the three field tuples above.
 */
export const SORT_FIELDS_BY_LIST: Record<ListId, readonly string[]> = {
  members: MEMBER_SORT_FIELDS,
  instruments: INSTRUMENT_SORT_FIELDS,
  events: EVENT_SORT_FIELDS,
};

// ── Persisted document schema ─────────────────────────

const memberEntrySchema = z.object({
  sortBy: z.enum(MEMBER_SORT_FIELDS),
  direction: z.enum(SORT_DIRECTIONS),
});

const instrumentEntrySchema = z.object({
  sortBy: z.enum(INSTRUMENT_SORT_FIELDS),
  direction: z.enum(SORT_DIRECTIONS),
});

const eventEntrySchema = z.object({
  sortBy: z.enum(EVENT_SORT_FIELDS),
  direction: z.enum(SORT_DIRECTIONS),
});

/**
 * Shape of umsuka.user_preferences.list_ordering. Every entry is
 * optional (a list without an entry falls back to DEFAULT_SORT) and
 * unknown keys are STRIPPED by Zod, so documents written by future
 * versions of the app parse cleanly instead of being discarded.
 */
export const listOrderingSchema = z.object({
  members: memberEntrySchema.optional(),
  instruments: instrumentEntrySchema.optional(),
  events: eventEntrySchema.optional(),
});

export type ListOrdering = z.infer<typeof listOrderingSchema>;

/** Empty document: every list uses its default sort. */
export const DEFAULT_LIST_ORDERING: ListOrdering = {};

export interface SortSelection<SortField extends string = string> {
  sortBy: SortField;
  direction: SortDirection;
}

/**
 * Server-side default sort per listing (what users see before saving any
 * preference). Keys are typed precisely so pages can pass
 * `DEFAULT_SORT.members.sortBy` straight into `sortMembers` etc.
 */
export const DEFAULT_SORT: {
  members: SortSelection<MemberSortField>;
  instruments: SortSelection<InstrumentSortField>;
  events: SortSelection<EventSortField>;
} = {
  members: { sortBy: "name", direction: "asc" },
  instruments: { sortBy: "name", direction: "asc" },
  events: { sortBy: "event_date", direction: "asc" },
};

/**
 * Defensive parser for anything read from the DB (or elsewhere). A
 * corrupted or legacy document NEVER breaks a listing: it logs a warning
 * and degrades to the defaults.
 */
export function parseListOrdering(raw: unknown): ListOrdering {
  const parsed = listOrderingSchema.safeParse(raw);
  if (!parsed.success) {
    console.warn(
      "parseListOrdering: documento de ordenación inválido; se usan los valores por defecto.",
    );
    return {};
  }
  return parsed.data;
}

// ── Save input schema ─────────────────────────────────

/**
 * Payload of saveListOrderingAction. `sortBy` is validated as a generic
 * non-empty string here; the cross-check against SORT_FIELDS_BY_LIST
 * happens in the mutation so its error message can name the list.
 */
export const saveListOrderingInputSchema = z.object({
  listId: z.enum(LIST_IDS, { errorMap: () => ({ message: "Listado no válido." }) }),
  sortBy: z.string().min(1, { message: "Campo de ordenación no válido." }),
  direction: z.enum(SORT_DIRECTIONS, {
    errorMap: () => ({ message: "Dirección de ordenación no válida." }),
  }),
});

export type SaveListOrderingInput = z.infer<typeof saveListOrderingInputSchema>;

// ── Labeled options for the UI selects ────────────────

export const MEMBER_SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "name", label: "Nombre" },
  { value: "created_at", label: "Fecha de alta" },
  { value: "workgroup", label: "Grupo de trabajo" },
  { value: "component_type", label: "Componente" },
];

export const INSTRUMENT_SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "name", label: "Nombre" },
  { value: "category", label: "Categoría" },
  { value: "created_at", label: "Fecha de creación" },
  { value: "assignee", label: "Responsable" },
];

export const EVENT_SORT_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "event_date", label: "Fecha" },
  { value: "title", label: "Título" },
  { value: "created_at", label: "Fecha de creación" },
];
