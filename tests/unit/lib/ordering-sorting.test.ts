import { describe, it, expect } from "vitest";

import { applySorting, sortEvents, sortInstruments, sortMembers } from "@/lib/ordering/sorting";
import type { MemberListItem } from "@/lib/members/schema";
import type { InstrumentItem } from "@/lib/instruments/queries";
import type { EventListItem } from "@/lib/events/queries";

// ── Factories ─────────────────────────────────────────

let seq = 0;

function makeMember(overrides: Partial<MemberListItem> = {}): MemberListItem {
  seq += 1;
  return {
    id: `member-${String(seq).padStart(2, "0")}`,
    firstName: "Ada",
    lastName: "Lovelace",
    componentType: "music",
    workgroup: "telas",
    role: "member",
    isActive: true,
    status: "active",
    username: null,
    authMethod: "google",
    componentLeadFor: null,
    createdAt: "2026-01-01T10:00:00.000Z",
    ...overrides,
  };
}

function makeInstrument(overrides: Partial<InstrumentItem> = {}): InstrumentItem {
  seq += 1;
  return {
    id: `instrument-${String(seq).padStart(2, "0")}`,
    name: "Tambor",
    category: "Percusión",
    description: null,
    isActive: true,
    createdAt: "2026-02-01T10:00:00.000Z",
    updatedAt: "2026-02-01T10:00:00.000Z",
    currentAssignee: null,
    ...overrides,
  };
}

function makeEvent(overrides: Partial<EventListItem> = {}): EventListItem {
  seq += 1;
  return {
    id: `event-${String(seq).padStart(2, "0")}`,
    title: "Ensayo general",
    description: null,
    eventType: "rehearsal",
    eventDate: "2026-03-01T18:00:00.000Z",
    capacity: null,
    location: null,
    imageUrl: null,
    registrationDeadline: null,
    morningSession: false,
    afternoonSession: false,
    visibleToGroup: null,
    createdByWorkgroup: null,
    audienceType: "all",
    audienceWorkgroup: null,
    audienceMemberType: null,
    createdBy: null,
    createdAt: "2026-01-15T09:00:00.000Z",
    ...overrides,
  };
}

const idsOf = <T extends { id: string }>(items: readonly T[]): string[] =>
  items.map((item) => item.id);

describe("applySorting (generic engine)", () => {
  it("sorts with multiple selectors in order", () => {
    const rows = [
      { id: "c", group: "b", rank: 2 },
      { id: "a", group: "a", rank: 9 },
      { id: "b", group: "a", rank: 1 },
      { id: "d", group: "a", rank: 1 },
    ];

    const sorted = applySorting(
      rows,
      [(row) => row.group, (row) => row.rank],
      "asc",
      (row) => row.id,
    );

    // Group "a" first; inside it rank 1 ties (b, d) → id breaks the tie.
    expect(idsOf(sorted)).toEqual(["b", "d", "a", "c"]);
  });

  it("does not mutate the input array", () => {
    const rows = [{ id: "b" }, { id: "a" }];
    const copy = [...rows];

    applySorting(rows, [], "asc", (row) => row.id);

    expect(rows).toEqual(copy);
    expect(rows).not.toBe(copy);
  });

  it("handles empty and single-element arrays", () => {
    expect(applySorting([], [], "asc", () => "x")).toEqual([]);
    expect(idsOf(applySorting([{ id: "only" }], [], "desc", (r) => r.id))).toEqual(["only"]);
  });
});

describe("sortMembers", () => {
  it("is accent- and case-insensitive on names (Álvaro ≡ alvaro)", () => {
    const members = [
      makeMember({ id: "m1", firstName: "alvaro", lastName: "García" }),
      makeMember({ id: "m2", firstName: "Álvaro", lastName: "garcía" }),
      makeMember({ id: "m3", firstName: "Beatriz", lastName: "Ibáñez" }),
    ];
    // "alvaro garcía" and "Álvaro garcía" are EQUAL under base
    // collation → the stable id tie-breaker decides (m1 < m2); the
    // accented "Ibáñez" still sorts after plain "García".
    const sorted = sortMembers(members, "name", "asc");

    expect(idsOf(sorted)).toEqual(["m1", "m2", "m3"]);
  });

  it("reverses the order when direction is desc", () => {
    const members = [
      makeMember({ id: "m1", firstName: "Ana" }),
      makeMember({ id: "m2", firstName: "Bruno" }),
      makeMember({ id: "m3", firstName: "Carla" }),
    ];

    expect(idsOf(sortMembers(members, "name", "asc"))).toEqual(["m1", "m2", "m3"]);
    expect(idsOf(sortMembers(members, "name", "desc"))).toEqual(["m3", "m2", "m1"]);
  });

  it("sorts by creation date chronologically", () => {
    const members = [
      makeMember({ id: "m1", createdAt: "2026-05-01T00:00:00.000Z" }),
      makeMember({ id: "m2", createdAt: "2024-01-01T00:00:00.000Z" }),
      makeMember({ id: "m3", createdAt: "2025-08-14T00:00:00.000Z" }),
    ];

    expect(idsOf(sortMembers(members, "created_at", "asc"))).toEqual(["m2", "m3", "m1"]);
  });

  it("sorts by workgroup and by component_type", () => {
    const members = [
      makeMember({ id: "m1", workgroup: "telas", componentType: "dance" }),
      makeMember({ id: "m2", workgroup: "barra", componentType: "member" }),
      makeMember({ id: "m3", workgroup: "estandarte", componentType: "music" }),
    ];

    expect(idsOf(sortMembers(members, "workgroup", "asc"))).toEqual(["m2", "m3", "m1"]);
    // Alphabetical: dance < member < music.
    expect(idsOf(sortMembers(members, "component_type", "asc"))).toEqual(["m1", "m2", "m3"]);
  });

  it("breaks ties deterministically by id ascending", () => {
    const members = [
      makeMember({ id: "z9", workgroup: "barra" }),
      makeMember({ id: "a1", workgroup: "telas" }),
      makeMember({ id: "m5", workgroup: "barra" }),
    ];

    // All share... no: barra ties break by id; telas sorts after barra.
    expect(idsOf(sortMembers(members, "workgroup", "asc"))).toEqual(["m5", "z9", "a1"]);
  });
});

describe("sortInstruments", () => {
  it("keeps null categories LAST in asc AND desc", () => {
    const instruments = [
      makeInstrument({ id: "i1", name: "Flauta", category: null }),
      makeInstrument({ id: "i2", name: "Tambor", category: "Percusión" }),
      makeInstrument({ id: "i3", name: "Castañuelas", category: null }),
      makeInstrument({ id: "i4", name: "Laúd", category: "Cuerda" }),
    ];

    const asc = sortInstruments(instruments, "category", "asc");
    const desc = sortInstruments(instruments, "category", "desc");

    expect(asc.map((item) => item.category)).toEqual(["Cuerda", "Percusión", null, null]);
    expect(desc.map((item) => item.category)).toEqual(["Percusión", "Cuerda", null, null]);
  });

  it("keeps unassigned instruments LAST when sorting by assignee, both directions", () => {
    const instruments = [
      makeInstrument({
        id: "i1",
        name: "Tambor",
        currentAssignee: { id: "u2", firstName: "Zoe", lastName: "García" },
      }),
      makeInstrument({ id: "i2", name: "Flauta", currentAssignee: null }),
      makeInstrument({
        id: "i3",
        name: "Laúd",
        currentAssignee: { id: "u1", firstName: "Ana", lastName: "López" },
      }),
    ];

    const asc = sortInstruments(instruments, "assignee", "asc");
    const desc = sortInstruments(instruments, "assignee", "desc");

    expect(asc.map((item) => item.currentAssignee?.firstName ?? null)).toEqual([
      "Ana",
      "Zoe",
      null,
    ]);
    expect(desc.map((item) => item.currentAssignee?.firstName ?? null)).toEqual([
      "Zoe",
      "Ana",
      null,
    ]);
  });

  it("compares digit sequences numerically (Turno 2 < Turno 10)", () => {
    const instruments = [
      makeInstrument({ id: "i1", name: "Turno 10" }),
      makeInstrument({ id: "i2", name: "Turno 2" }),
      makeInstrument({ id: "i3", name: "Turno 1" }),
    ];

    expect(idsOf(sortInstruments(instruments, "name", "asc"))).toEqual(["i3", "i2", "i1"]);
  });

  it("sorts by creation date chronologically", () => {
    const instruments = [
      makeInstrument({ id: "i1", createdAt: "2026-06-01T00:00:00.000Z" }),
      makeInstrument({ id: "i2", createdAt: "2025-01-01T00:00:00.000Z" }),
    ];

    expect(idsOf(sortInstruments(instruments, "created_at", "asc"))).toEqual(["i2", "i1"]);
  });
});

describe("sortEvents", () => {
  it("orders chronologically by event_date and reverses with desc", () => {
    const events = [
      makeEvent({ id: "e1", eventDate: "2026-04-10T18:00:00.000Z" }),
      makeEvent({ id: "e2", eventDate: "2026-03-02T10:00:00.000Z" }),
      makeEvent({ id: "e3", eventDate: "2026-05-20T09:00:00.000Z" }),
    ];

    expect(idsOf(sortEvents(events, "event_date", "asc"))).toEqual(["e2", "e1", "e3"]);
    expect(idsOf(sortEvents(events, "event_date", "desc"))).toEqual(["e3", "e1", "e2"]);
  });

  it("sorts by title accent-insensitively", () => {
    const events = [
      makeEvent({ id: "e1", title: "Última reunión" }),
      makeEvent({ id: "e2", title: "actuación de carnaval" }),
      makeEvent({ id: "e3", title: "Actuación en Águilas" }),
    ];
    // e2/e3 tie under base collation ("actuacion..." vs "Actuacion en...")
    // → "de" < "en" decides between them; Ú goes last.
    const sorted = sortEvents(events, "title", "asc");

    expect(idsOf(sorted)).toEqual(["e2", "e3", "e1"]);
  });

  it("treats an unparseable date as missing and sinks it to the end", () => {
    const events = [
      makeEvent({ id: "e1", eventDate: "not-a-date" }),
      makeEvent({ id: "e2", eventDate: "2026-03-02T10:00:00.000Z" }),
    ];

    expect(idsOf(sortEvents(events, "event_date", "asc"))).toEqual(["e2", "e1"]);
    expect(idsOf(sortEvents(events, "event_date", "desc"))).toEqual(["e2", "e1"]);
  });
});
