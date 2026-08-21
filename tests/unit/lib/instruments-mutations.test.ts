import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted above the imports below by vitest) ──

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import {
  createInstrument,
  updateInstrument,
  toggleInstrumentActive,
  assignInstrument,
  unassignInstrument,
} from "@/lib/instruments/mutations";
import type { AuthenticatedProfile } from "@/types/auth";

const mockFrom = vi.fn();

const INSTRUMENT_ID = "123e4567-e89b-12d3-a456-426614174001";
const USER_ID = "123e4567-e89b-12d3-a456-426614174002";

// ── Chain-builder stub (mirrors votings-mutations test pattern) ──
// `selectResult` feeds .single()/.maybeSingle() AND awaited select /
// update chains; `awaitedInsert` feeds awaited insert chains; the
// optional `awaitedUpdate` lets tests separate the close-assignment
// UPDATE from the subsequent INSERT .single() on the same table.

interface QueryResult {
  data?: unknown[] | null;
  error?: Error | null;
}

function makeTableMock(
  selectResult: QueryResult = { data: null, error: null },
  awaitedInsert: QueryResult = selectResult,
  awaitedUpdate: QueryResult = selectResult,
) {
  const resolveSingle = () =>
    Promise.resolve(
      Array.isArray(selectResult.data)
        ? { data: selectResult.data[0] ?? null, error: selectResult.error ?? null }
        : selectResult,
    );

  const selectThenable = Promise.resolve(selectResult);
  const insertThenable = Promise.resolve(awaitedInsert);
  const updateThenable = Promise.resolve(awaitedUpdate);

  let lastOp: "select" | "insert" | "update" = "select";

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    is: vi.fn(() => builder),
    order: vi.fn(() => builder),
    in: vi.fn(() => builder),
    update: vi.fn(() => {
      lastOp = "update";
      return builder;
    }),
    delete: vi.fn(() => builder),
    insert: vi.fn(() => {
      lastOp = "insert";
      return builder;
    }),
    maybeSingle: vi.fn(resolveSingle),
    single: vi.fn(resolveSingle),
    then: (
      onfulfilled?: ((value: QueryResult) => QueryResult | PromiseLike<QueryResult>) | null,
      onrejected?: ((reason: unknown) => QueryResult | PromiseLike<QueryResult>) | null,
    ) =>
      (lastOp === "insert"
        ? insertThenable
        : lastOp === "update"
          ? updateThenable
          : selectThenable
      ).then(onfulfilled, onrejected),
    catch: (
      onrejected?: ((reason: unknown) => QueryResult | PromiseLike<QueryResult>) | null,
    ) => (lastOp === "insert" ? insertThenable : selectThenable).catch(onrejected),
    finally: (onfinally?: (() => void) | null) =>
      (lastOp === "insert" ? insertThenable : selectThenable).finally(onfinally),
  };

  return builder;
}

type TableKey = "instruments" | "instrument_assignments" | "profiles";

interface TableResults {
  select?: QueryResult;
  /** Feeds awaited INSERT chains (e.g. the new assignment insert). */
  awaited?: QueryResult;
  /** Feeds awaited UPDATE chains (e.g. closing the active assignment). */
  awaitedUpdate?: QueryResult;
}

function setupTables(
  tables: Partial<Record<TableKey, TableResults>> = {},
): Record<TableKey, ReturnType<typeof makeTableMock>> {
  const builders: Record<TableKey, ReturnType<typeof makeTableMock>> = {
    instruments: makeTableMock(
      tables.instruments?.select ?? { data: null, error: null },
      tables.instruments?.awaited ?? { data: null, error: null },
      tables.instruments?.awaitedUpdate ?? { data: null, error: null },
    ),
    instrument_assignments: makeTableMock(
      tables.instrument_assignments?.select ?? { data: null, error: null },
      tables.instrument_assignments?.awaited ?? { data: null, error: null },
      tables.instrument_assignments?.awaitedUpdate ?? { data: null, error: null },
    ),
    profiles: makeTableMock(
      tables.profiles?.select ?? { data: null, error: null },
      tables.profiles?.awaited ?? { data: null, error: null },
      tables.profiles?.awaitedUpdate ?? { data: null, error: null },
    ),
  };

  mockFrom.mockImplementation(
    (table: string) =>
      builders[table as TableKey] ??
      makeTableMock({ data: null, error: null }),
  );

  return builders;
}

// ── Fixtures ───────────────────────────────────────────

function actor(role: AuthenticatedProfile["role"] = "super_admin"): AuthenticatedProfile {
  return {
    id: "actor-1",
    firstName: "Marta",
    lastName: "Admin",
    email: null,
    avatarUrl: null,
    role,
    componentType: "member",
    workgroup: "ninguno",
    isWorkgroupLead: false,
    componentLeadFor: null,
    birthDate: null,
    isActive: true,
    status: "active",
    username: null,
    authMethod: "google",
    bio: null,
    phone: null,
    skills: [],
    joinedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

function duplicateKeyError(): Error {
  return Object.assign(new Error("duplicate key value violates unique constraint"), {
    code: "23505",
  });
}

function foreignKeyError(): Error {
  return Object.assign(
    new Error("insert or update on table violates foreign key constraint"),
    { code: "23503" },
  );
}

/** Row shape returned by the assignability pre-check on profiles. */
function assignableProfile(overrides: Record<string, unknown> = {}) {
  return { is_active: true, status: "active", deleted_at: null, ...overrides };
}

function validCreateInput() {
  // Mirrors what the client form actually sends: an omitted/empty
  // description arrives as undefined, never as null (the zod schema
  // normalizes "" -> null afterwards).
  return { name: "Tambor Mayor", category: "Percusión" };
}

async function expectRejectedAsMember(
  action: () => Promise<{ success: boolean; error?: string }>,
) {
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor("member"));

  const result = await action();

  expect(result.success).toBe(false);
  expect(result.error).toBe("Solo la directiva puede gestionar instrumentos.");
  expect(mockFrom).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue({
    from: mockFrom,
  } as unknown as ReturnType<typeof createClient>);
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor());
});

// ── createInstrument ───────────────────────────────────

describe("createInstrument", () => {
  it("rejects non-management members without touching the database", async () => {
    await expectRejectedAsMember(() => createInstrument(validCreateInput()));
  });

  it("creates the instrument", async () => {
    const builders = setupTables({
      instruments: { select: { data: [{ id: "inst-1" }] } },
    });

    const result = await createInstrument(validCreateInput());

    expect(result).toEqual({ success: true, id: "inst-1" });
    expect(builders.instruments.insert).toHaveBeenCalledWith({
      name: "Tambor Mayor",
      category: "Percusión",
      description: null,
    });
  });

  it("maps a 23505 unique violation to a friendly message", async () => {
    const builders = setupTables({
      instruments: { select: { error: duplicateKeyError() } },
    });

    const result = await createInstrument(validCreateInput());

    expect(result.success).toBe(false);
    expect(result.error).toBe("Ya existe un instrumento con ese nombre.");
    expect(builders.instruments.insert).toHaveBeenCalledTimes(1);
  });

  it("returns the raw message for non-unique errors", async () => {
    setupTables({
      instruments: { select: { error: new Error("connection refused") } },
    });

    const result = await createInstrument(validCreateInput());

    expect(result.success).toBe(false);
    expect(result.error).toBe("connection refused");
  });

  it("rejects invalid input without touching the database", async () => {
    const result = await createInstrument({ name: "   " } as never);

    expect(result.success).toBe(false);
    expect(result.error).toBe("El nombre es obligatorio.");
    expect(mockFrom).not.toHaveBeenCalled();
  });
});

// ── updateInstrument ───────────────────────────────────

describe("updateInstrument", () => {
  it("rejects non-management members", async () => {
    await expectRejectedAsMember(() =>
      updateInstrument({
        id: INSTRUMENT_ID,
        name: "Tambor",
        category: "",
        description: "",
      }),
    );
  });

  it("updates the instrument when it exists", async () => {
    const builders = setupTables({
      instruments: { select: { data: [{ id: INSTRUMENT_ID }] } },
    });

    const result = await updateInstrument({
      id: INSTRUMENT_ID,
      name: "Tambor",
      category: "",
      description: "Nueva descripción",
    });

    expect(result).toEqual({ success: true });
    expect(builders.instruments.update).toHaveBeenCalledWith({
      name: "Tambor",
      category: null,
      description: "Nueva descripción",
    });
    expect(builders.instruments.eq).toHaveBeenCalledWith("id", INSTRUMENT_ID);
  });

  it("returns 'Instrumento no encontrado.' when the instrument is missing", async () => {
    const builders = setupTables({ instruments: { select: { data: [] } } });

    const result = await updateInstrument({ id: INSTRUMENT_ID, name: "Tambor" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Instrumento no encontrado.");
    expect(builders.instruments.update).not.toHaveBeenCalled();
  });

  it("maps a 23505 unique violation to a friendly message", async () => {
    setupTables({
      instruments: {
        select: { data: [{ id: INSTRUMENT_ID }] },
        awaitedUpdate: { error: duplicateKeyError() },
      },
    });

    const result = await updateInstrument({ id: INSTRUMENT_ID, name: "Tambor" });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Ya existe un instrumento con ese nombre.");
  });
});

// ── toggleInstrumentActive ─────────────────────────────

describe("toggleInstrumentActive", () => {
  it("rejects non-management members", async () => {
    await expectRejectedAsMember(() =>
      toggleInstrumentActive({ instrument_id: INSTRUMENT_ID }),
    );
  });

  it("flips an active instrument to inactive", async () => {
    const builders = setupTables({
      instruments: { select: { data: [{ is_active: true }] } },
    });

    const result = await toggleInstrumentActive({ instrument_id: INSTRUMENT_ID });

    expect(result).toEqual({ success: true });
    expect(builders.instruments.update).toHaveBeenCalledWith({ is_active: false });
    expect(builders.instruments.eq).toHaveBeenCalledWith("id", INSTRUMENT_ID);
  });

  it("flips an inactive instrument to active", async () => {
    const builders = setupTables({
      instruments: { select: { data: [{ is_active: false }] } },
    });

    const result = await toggleInstrumentActive({ instrument_id: INSTRUMENT_ID });

    expect(result).toEqual({ success: true });
    expect(builders.instruments.update).toHaveBeenCalledWith({ is_active: true });
  });

  it("returns 'Instrumento no encontrado.' when the instrument is missing", async () => {
    const builders = setupTables({ instruments: { select: { data: [] } } });

    const result = await toggleInstrumentActive({ instrument_id: INSTRUMENT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Instrumento no encontrado.");
    expect(builders.instruments.update).not.toHaveBeenCalled();
  });
});

// ── assignInstrument ───────────────────────────────────

describe("assignInstrument", () => {
  it("rejects non-management members", async () => {
    await expectRejectedAsMember(() =>
      assignInstrument({ instrument_id: INSTRUMENT_ID, user_id: USER_ID }),
    );
  });

  it("closes the previous active assignment and inserts the new one", async () => {
    const builders = setupTables({
      instruments: { select: { data: [{ is_active: true }] } },
      profiles: { select: { data: [assignableProfile()] } },
      instrument_assignments: {
        // feeds .single() on the new-assignment insert (the result id)
        select: { data: [{ id: "assign-1" }] },
      },
    });

    const result = await assignInstrument({
      instrument_id: INSTRUMENT_ID,
      user_id: USER_ID,
    });

    expect(result).toEqual({ success: true, id: "assign-1" });
    expect(builders.profiles.eq).toHaveBeenCalledWith("id", USER_ID);
    expect(builders.instrument_assignments.update).toHaveBeenCalledWith(
      expect.objectContaining({ unassigned_at: expect.any(String) }),
    );
    expect(builders.instrument_assignments.eq).toHaveBeenCalledWith(
      "instrument_id",
      INSTRUMENT_ID,
    );
    expect(builders.instrument_assignments.is).toHaveBeenCalledWith(
      "unassigned_at",
      null,
    );
    expect(builders.instrument_assignments.insert).toHaveBeenCalledWith({
      instrument_id: INSTRUMENT_ID,
      user_id: USER_ID,
    });
  });

  it("rejects assigning an inactive instrument", async () => {
    const builders = setupTables({
      instruments: { select: { data: [{ is_active: false }] } },
    });

    const result = await assignInstrument({
      instrument_id: INSTRUMENT_ID,
      user_id: USER_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("No se puede asignar un instrumento inactivo.");
    expect(builders.instrument_assignments.insert).not.toHaveBeenCalled();
  });

  it("returns 'Instrumento no encontrado.' when the instrument is missing", async () => {
    const builders = setupTables({ instruments: { select: { data: [] } } });

    const result = await assignInstrument({
      instrument_id: INSTRUMENT_ID,
      user_id: USER_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Instrumento no encontrado.");
    expect(builders.instrument_assignments.insert).not.toHaveBeenCalled();
  });

  it("maps a 23505 insert violation (race) to a friendly message", async () => {
    setupTables({
      instruments: { select: { data: [{ is_active: true }] } },
      profiles: { select: { data: [assignableProfile()] } },
      instrument_assignments: {
        // the close-UPDATE must succeed, the INSERT .single() must fail
        awaitedUpdate: { data: null, error: null },
        select: { error: duplicateKeyError() },
      },
    });

    const result = await assignInstrument({
      instrument_id: INSTRUMENT_ID,
      user_id: USER_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "El instrumento ya tiene una persona responsable asignada.",
    );
  });

  it("maps a 23503 insert FK violation to a friendly message", async () => {
    setupTables({
      instruments: { select: { data: [{ is_active: true }] } },
      profiles: { select: { data: [assignableProfile()] } },
      instrument_assignments: {
        // the member was removed between render and submit: the
        // pre-check passed but the INSERT hits the FK violation.
        awaitedUpdate: { data: null, error: null },
        select: { error: foreignKeyError() },
      },
    });

    const result = await assignInstrument({
      instrument_id: INSTRUMENT_ID,
      user_id: USER_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "El miembro seleccionado ya no está disponible.",
    );
  });

  it.each([
    { name: "does not exist", profile: [] },
    { name: "is inactive", profile: [assignableProfile({ is_active: false })] },
    {
      name: "is not approved yet",
      profile: [assignableProfile({ status: "pending" })],
    },
    {
      name: "was soft-deleted",
      profile: [assignableProfile({ deleted_at: "2026-08-01T00:00:00Z" })],
    },
  ])(
    "does not close the active assignment when the target member $name",
    async ({ profile }) => {
      const builders = setupTables({
        instruments: { select: { data: [{ is_active: true }] } },
        profiles: { select: { data: profile } },
      });

      const result = await assignInstrument({
        instrument_id: INSTRUMENT_ID,
        user_id: USER_ID,
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe(
        "El miembro seleccionado ya no está disponible.",
      );
      // The close-then-insert gap must be avoided: the previous
      // responsable keeps the instrument when the new one is invalid.
      expect(builders.instrument_assignments.update).not.toHaveBeenCalled();
      expect(builders.instrument_assignments.insert).not.toHaveBeenCalled();
    },
  );

  it("returns the close-update error when closing the previous assignment fails", async () => {
    const builders = setupTables({
      instruments: { select: { data: [{ is_active: true }] } },
      profiles: { select: { data: [assignableProfile()] } },
      instrument_assignments: {
        awaitedUpdate: { error: new Error("close exploded") },
      },
    });

    const result = await assignInstrument({
      instrument_id: INSTRUMENT_ID,
      user_id: USER_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("close exploded");
    expect(builders.instrument_assignments.insert).not.toHaveBeenCalled();
  });
});

// ── unassignInstrument ─────────────────────────────────

describe("unassignInstrument", () => {
  it("rejects non-management members", async () => {
    await expectRejectedAsMember(() =>
      unassignInstrument({ instrument_id: INSTRUMENT_ID }),
    );
  });

  it("closes the active assignment", async () => {
    const builders = setupTables({
      instrument_assignments: { select: { data: [{ id: "assign-1" }] } },
    });

    const result = await unassignInstrument({ instrument_id: INSTRUMENT_ID });

    expect(result).toEqual({ success: true });
    expect(builders.instrument_assignments.update).toHaveBeenCalledWith(
      expect.objectContaining({ unassigned_at: expect.any(String) }),
    );
    expect(builders.instrument_assignments.eq).toHaveBeenCalledWith(
      "instrument_id",
      INSTRUMENT_ID,
    );
    expect(builders.instrument_assignments.is).toHaveBeenCalledWith(
      "unassigned_at",
      null,
    );
  });

  it("returns an error when there is no active assignment", async () => {
    const builders = setupTables({
      instrument_assignments: { select: { data: [] } },
    });

    const result = await unassignInstrument({ instrument_id: INSTRUMENT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe(
      "El instrumento no tiene una persona responsable asignada.",
    );
    expect(builders.instrument_assignments.update).toHaveBeenCalledTimes(1);
  });
});