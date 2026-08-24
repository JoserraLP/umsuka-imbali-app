import { describe, it, expect, vi, afterEach } from "vitest";

import {
  DEFAULT_LIST_ORDERING,
  DEFAULT_SORT,
  EVENT_SORT_FIELDS,
  EVENT_SORT_OPTIONS,
  INSTRUMENT_SORT_FIELDS,
  INSTRUMENT_SORT_OPTIONS,
  LIST_IDS,
  MEMBER_SORT_FIELDS,
  MEMBER_SORT_OPTIONS,
  SORT_DIRECTIONS,
  SORT_FIELDS_BY_LIST,
  listOrderingSchema,
  parseListOrdering,
  saveListOrderingInputSchema,
} from "@/lib/ordering/schema";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("listOrderingSchema", () => {
  it("accepts a complete document", () => {
    const result = listOrderingSchema.safeParse({
      members: { sortBy: "name", direction: "desc" },
      instruments: { sortBy: "category", direction: "asc" },
      events: { sortBy: "event_date", direction: "desc" },
    });

    expect(result.success).toBe(true);
  });

  it("accepts a partial document (every entry is optional)", () => {
    const result = listOrderingSchema.safeParse({
      instruments: { sortBy: "name", direction: "asc" },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.members).toBeUndefined();
      expect(result.data.instruments).toEqual({ sortBy: "name", direction: "asc" });
      expect(result.data.events).toBeUndefined();
    }
  });

  it("strips unknown keys (forward-compatible)", () => {
    const result = listOrderingSchema.safeParse({
      members: { sortBy: "name", direction: "asc" },
      profile: "some-future-preference",
      news: { sortBy: "title", direction: "asc" },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).toEqual(["members"]);
      expect(JSON.parse(JSON.stringify(result.data))).toEqual({
        members: { sortBy: "name", direction: "asc" },
      });
    }
  });

  it("rejects an invalid sortBy inside an entry", () => {
    const result = listOrderingSchema.safeParse({
      members: { sortBy: "nickname", direction: "asc" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects an invalid direction inside an entry", () => {
    const result = listOrderingSchema.safeParse({
      events: { sortBy: "title", direction: "sideways" },
    });

    expect(result.success).toBe(false);
  });

  it("rejects entries that are not objects", () => {
    expect(listOrderingSchema.safeParse({ members: "name" }).success).toBe(false);
    expect(listOrderingSchema.safeParse({ events: ["title"] }).success).toBe(false);
    expect(listOrderingSchema.safeParse({ instruments: 42 }).success).toBe(false);
  });

  it("rejects a root that is not an object", () => {
    expect(listOrderingSchema.safeParse("texto").success).toBe(false);
    expect(listOrderingSchema.safeParse(7).success).toBe(false);
    expect(listOrderingSchema.safeParse(null).success).toBe(false);
  });
});

describe("parseListOrdering", () => {
  it("returns the parsed document for valid input", () => {
    expect(parseListOrdering({ members: { sortBy: "workgroup", direction: "desc" } })).toEqual({
      members: { sortBy: "workgroup", direction: "desc" },
    });
  });

  it("degrades to {} with a warning for null / string / array / number input", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(parseListOrdering(null)).toEqual({});
    expect(parseListOrdering("garbage")).toEqual({});
    expect(parseListOrdering([1, 2])).toEqual({});
    expect(parseListOrdering(42)).toEqual({});

    expect(warn).toHaveBeenCalledTimes(4);
  });

  it("degrades to {} for valid-root-but-invalid-entry documents", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    expect(parseListOrdering({ members: { sortBy: "name" } })).toEqual({});
    expect(
      parseListOrdering({ instruments: { sortBy: "assignee", direction: "up" } }),
    ).toEqual({});

    expect(warn).toHaveBeenCalled();
  });
});

describe("saveListOrderingInputSchema + cross-validation table", () => {
  it("accepts a field that belongs to its list (instruments + assignee)", () => {
    const parsed = saveListOrderingInputSchema.safeParse({
      listId: "instruments",
      sortBy: "assignee",
      direction: "asc",
    });

    expect(parsed.success).toBe(true);
    expect(SORT_FIELDS_BY_LIST.instruments.includes("assignee")).toBe(true);
  });

  it("exposes the fields each list accepts", () => {
    expect([...SORT_FIELDS_BY_LIST.members]).toEqual([...MEMBER_SORT_FIELDS]);
    expect([...SORT_FIELDS_BY_LIST.instruments]).toEqual([...INSTRUMENT_SORT_FIELDS]);
    expect([...SORT_FIELDS_BY_LIST.events]).toEqual([...EVENT_SORT_FIELDS]);
  });

  it("marks members + assignee as invalid (cross-validation)", () => {
    // The schema itself only validates the generic shape; the mutation
    // applies SORT_FIELDS_BY_LIST — here we assert what that check does.
    expect(SORT_FIELDS_BY_LIST.members.includes("assignee")).toBe(false);
    expect(SORT_FIELDS_BY_LIST.events.includes("category")).toBe(false);
    expect(SORT_FIELDS_BY_LIST.instruments.includes("workgroup")).toBe(false);

    // The raw payload parses (shape-wise) even though it will be
    // rejected by the cross-check in the mutation.
    const parsed = saveListOrderingInputSchema.safeParse({
      listId: "members",
      sortBy: "assignee",
      direction: "asc",
    });
    expect(parsed.success).toBe(true);
  });

  it("only accepts asc/desc directions and known lists", () => {
    expect(saveListOrderingInputSchema.safeParse({
      listId: "events",
      sortBy: "title",
      direction: "ASC", // case-sensitive on purpose
    }).success).toBe(false);

    expect(saveListOrderingInputSchema.safeParse({
      listId: "profile",
      sortBy: "name",
      direction: "asc",
    }).success).toBe(false);

    expect(saveListOrderingInputSchema.safeParse({
      listId: "members",
      sortBy: "",
      direction: "asc",
    }).success).toBe(false);
  });
});

describe("constants", () => {
  it("exposes the three managed lists and two directions", () => {
    expect(LIST_IDS).toEqual(["members", "instruments", "events"]);
    expect(SORT_DIRECTIONS).toEqual(["asc", "desc"]);
  });

  it("defaults every list to its documented sort", () => {
    expect(DEFAULT_LIST_ORDERING).toEqual({});
    expect(DEFAULT_SORT.members).toEqual({ sortBy: "name", direction: "asc" });
    expect(DEFAULT_SORT.instruments).toEqual({ sortBy: "name", direction: "asc" });
    expect(DEFAULT_SORT.events).toEqual({ sortBy: "event_date", direction: "asc" });
  });

  it("labels every sort option of every list", () => {
    expect(MEMBER_SORT_OPTIONS.map((option) => option.value)).toEqual([
      ...MEMBER_SORT_FIELDS,
    ]);
    expect(MEMBER_SORT_OPTIONS.map((option) => option.label)).toEqual([
      "Nombre",
      "Fecha de alta",
      "Grupo de trabajo",
      "Componente",
    ]);

    expect(INSTRUMENT_SORT_OPTIONS.map((option) => option.value)).toEqual([
      ...INSTRUMENT_SORT_FIELDS,
    ]);
    expect(INSTRUMENT_SORT_OPTIONS.map((option) => option.label)).toEqual([
      "Nombre",
      "Categoría",
      "Fecha de creación",
      "Responsable",
    ]);

    expect(EVENT_SORT_OPTIONS.map((option) => option.value)).toEqual([...EVENT_SORT_FIELDS]);
    expect(EVENT_SORT_OPTIONS.map((option) => option.label)).toEqual([
      "Fecha",
      "Título",
      "Fecha de creación",
    ]);
  });
});
