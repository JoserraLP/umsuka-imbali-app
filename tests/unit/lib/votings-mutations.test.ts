import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted above the imports below by vitest) ──

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

vi.mock("@/lib/notifications/emit", () => ({
  notifyUsers: vi.fn().mockResolvedValue(undefined),
  getAllActiveMemberIds: vi.fn().mockResolvedValue([]),
  resolveEventRecipients: vi.fn().mockResolvedValue([]),
}));

import { createClient } from "@/lib/supabase/server";
import { requireAuthenticatedProfile } from "@/lib/auth/session";
import {
  createVoting,
  addOption,
  castVote,
  closeVoting,
} from "@/lib/votings/mutations";
import type { AuthenticatedProfile } from "@/types/auth";

const mockFrom = vi.fn();

const VOTING_ID = "123e4567-e89b-12d3-a456-426614174001";
const OPTION_ID = "123e4567-e89b-12d3-a456-426614174002";
const OTHER_OPTION_ID = "123e4567-e89b-12d3-a456-426614174003";

// ── Chain-builder stub (mirrors shifts-mutations test pattern) ──

interface QueryResult {
  data?: unknown[] | null;
  error?: Error | null;
}

/**
 * Builds a chainable table stub. `selectResult` feeds maybeSingle/single
 * reads AND awaited select-chains (e.g. the addOption count query);
 * `awaitedResult` feeds awaited insert calls, so tests can separate
 * reads from writes even when both land on the same table stub.
 */
function makeTableMock(
  selectResult: QueryResult = { data: null, error: null },
  awaitedResult: QueryResult = selectResult,
) {
  const resolveSingle = () =>
    Promise.resolve(
      Array.isArray(selectResult.data)
        ? { data: selectResult.data[0] ?? null, error: selectResult.error ?? null }
        : selectResult,
    );

  const selectThenable = Promise.resolve(selectResult);
  const awaitedThenable = Promise.resolve(awaitedResult);

  let lastOp: "select" | "insert" = "select";

  const builder = {
    select: vi.fn(() => {
      lastOp = "select";
      return builder;
    }),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    in: vi.fn(() => builder),
    update: vi.fn(() => builder),
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
      (lastOp === "insert" ? awaitedThenable : selectThenable).then(
        onfulfilled,
        onrejected,
      ),
    catch: (
      onrejected?: ((reason: unknown) => QueryResult | PromiseLike<QueryResult>) | null,
    ) => (lastOp === "insert" ? awaitedThenable : selectThenable).catch(onrejected),
    finally: (onfinally?: (() => void) | null) =>
      (lastOp === "insert" ? awaitedThenable : selectThenable).finally(onfinally),
  };

  return builder;
}

type TableKey = "votings" | "voting_options" | "voting_votes";

interface TableResults {
  select?: QueryResult;
  awaited?: QueryResult;
}

function setupTables(
  tables: Partial<Record<TableKey, TableResults>> = {},
): Record<TableKey, ReturnType<typeof makeTableMock>> {
  const builders: Record<TableKey, ReturnType<typeof makeTableMock>> = {
    votings: makeTableMock(
      tables.votings?.select ?? { data: null, error: null },
      tables.votings?.awaited ?? { data: null, error: null },
    ),
    voting_options: makeTableMock(
      tables.voting_options?.select ?? { data: null, error: null },
      tables.voting_options?.awaited ?? { data: null, error: null },
    ),
    voting_votes: makeTableMock(
      tables.voting_votes?.select ?? { data: null, error: null },
      tables.voting_votes?.awaited ?? { data: null, error: null },
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

function validCreateVotingInput() {
  return {
    title: "¿Dónde ensayamos?",
    description: "Elegimos sede del ensayo.",
    voting_deadline: null,
    options: ["Casa de la Cultura", "Centro Cívico"],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockReturnValue({
    from: mockFrom,
  } as unknown as ReturnType<typeof createClient>);
  vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor());
});

// ── createVoting ───────────────────────────────────────

describe("createVoting", () => {
  it("rejects non-management members without touching the database", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor("member"));

    const result = await createVoting(validCreateVotingInput());

    expect(result.success).toBe(false);
    expect(result.error).toBe("Solo la directiva puede crear votaciones.");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("creates the voting and its options", async () => {
    const builders = setupTables({
      votings: { select: { data: [{ id: "vot-1" }] } },
      voting_options: { awaited: { data: null, error: null } },
    });

    const result = await createVoting(validCreateVotingInput());

    expect(result).toEqual({ success: true, id: "vot-1" });
    expect(builders.votings.insert).toHaveBeenCalledWith({
      title: "¿Dónde ensayamos?",
      description: "Elegimos sede del ensayo.",
      voting_deadline: null,
      is_open: true,
    });
    expect(builders.voting_options.insert).toHaveBeenCalledWith([
      { voting_id: "vot-1", option_text: "Casa de la Cultura" },
      { voting_id: "vot-1", option_text: "Centro Cívico" },
    ]);
  });

  it("rolls back the voting when an option insert fails with a unique violation", async () => {
    const builders = setupTables({
      votings: { select: { data: [{ id: "vot-1" }] } },
      voting_options: { awaited: { error: duplicateKeyError() } },
    });

    const result = await createVoting(validCreateVotingInput());

    expect(result.success).toBe(false);
    expect(result.error).toBe("Ya existe una opción con ese enunciado.");
    expect(builders.votings.delete).toHaveBeenCalledTimes(1);
    expect(builders.votings.eq).toHaveBeenCalledWith("id", "vot-1");
  });

  it("returns the raw message for non-unique option insert errors", async () => {
    const builders = setupTables({
      votings: { select: { data: [{ id: "vot-1" }] } },
      voting_options: { awaited: { error: new Error("connection refused") } },
    });

    const result = await createVoting(validCreateVotingInput());

    expect(result.success).toBe(false);
    expect(result.error).toBe("connection refused");
    expect(builders.votings.delete).toHaveBeenCalledTimes(1);
  });
});

// ── addOption ──────────────────────────────────────────

describe("addOption", () => {
  it("rejects non-management members", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor("member"));

    const result = await addOption({
      voting_id: VOTING_ID,
      option_text: "Nueva opción",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Solo la directiva puede añadir opciones.");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("rejects adding an option to a closed voting", async () => {
    const builders = setupTables({
      votings: { select: { data: [{ is_open: false, voting_deadline: null }] } },
    });

    const result = await addOption({
      voting_id: VOTING_ID,
      option_text: "Nueva opción",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("La votación está cerrada.");
    expect(builders.voting_options.insert).not.toHaveBeenCalled();
  });

  it("rejects adding an option when the deadline has passed", async () => {
    setupTables({
      votings: {
        select: { data: [{ is_open: true, voting_deadline: "2020-01-01T00:00:00Z" }] },
      },
    });

    const result = await addOption({
      voting_id: VOTING_ID,
      option_text: "Nueva opción",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("La votación está cerrada.");
  });

  it("returns 'Votación no encontrada.' when the voting is missing", async () => {
    setupTables({ votings: { select: { data: [] } } });

    const result = await addOption({
      voting_id: VOTING_ID,
      option_text: "Nueva opción",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Votación no encontrada.");
  });

  it("maps a 23505 unique violation to 'Esa opción ya existe.'", async () => {
    const builders = setupTables({
      votings: { select: { data: [{ is_open: true, voting_deadline: null }] } },
      voting_options: { awaited: { error: duplicateKeyError() } },
    });

    const result = await addOption({
      voting_id: VOTING_ID,
      option_text: "Casa de la Cultura",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Esa opción ya existe.");
    expect(builders.voting_options.insert).toHaveBeenCalledWith({
      voting_id: VOTING_ID,
      option_text: "Casa de la Cultura",
    });
  });

  it("adds the option on success", async () => {
    const builders = setupTables({
      votings: { select: { data: [{ is_open: true, voting_deadline: null }] } },
      voting_options: { awaited: { data: null, error: null } },
    });

    const result = await addOption({
      voting_id: VOTING_ID,
      option_text: "Nueva opción",
    });

    expect(result).toEqual({ success: true });
    expect(builders.voting_options.insert).toHaveBeenCalledTimes(1);
  });

  it("returns the raw message when the option count query fails", async () => {
    setupTables({
      votings: { select: { data: [{ is_open: true, voting_deadline: null }] } },
      voting_options: { select: { error: new Error("count exploded") } },
    });

    const result = await addOption({
      voting_id: VOTING_ID,
      option_text: "Nueva opción",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("count exploded");
  });

  it("rejects the option when the voting already has 20 options", async () => {
    const existingOptions = Array.from({ length: 20 }, (_, i) => ({
      id: `opt-${i}`,
    }));
    const builders = setupTables({
      votings: { select: { data: [{ is_open: true, voting_deadline: null }] } },
      voting_options: { select: { data: existingOptions } },
    });

    const result = await addOption({
      voting_id: VOTING_ID,
      option_text: "Opción número 21",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Máximo 20 opciones por votación.");
    expect(builders.voting_options.insert).not.toHaveBeenCalled();
  });
});

// ── castVote ───────────────────────────────────────────

describe("castVote", () => {
  it("rejects a vote on a closed voting", async () => {
    const builders = setupTables({
      votings: { select: { data: [{ is_open: false, voting_deadline: null }] } },
    });

    const result = await castVote({
      voting_id: VOTING_ID,
      option_id: OPTION_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("La votación está cerrada.");
    expect(builders.voting_votes.insert).not.toHaveBeenCalled();
  });

  it("rejects a vote when the deadline has passed", async () => {
    const builders = setupTables({
      votings: {
        select: { data: [{ is_open: true, voting_deadline: "2020-01-01T00:00:00Z" }] },
      },
    });

    const result = await castVote({
      voting_id: VOTING_ID,
      option_id: OPTION_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("La votación está cerrada.");
    expect(builders.voting_votes.insert).not.toHaveBeenCalled();
  });

  it("rejects an option that does not belong to the voting", async () => {
    const builders = setupTables({
      votings: { select: { data: [{ is_open: true, voting_deadline: null }] } },
      voting_options: { select: { data: [] } },
    });

    const result = await castVote({
      voting_id: VOTING_ID,
      option_id: OPTION_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("La opción no pertenece a esta votación.");
    expect(builders.voting_options.eq).toHaveBeenCalledWith("voting_id", VOTING_ID);
    expect(builders.voting_votes.insert).not.toHaveBeenCalled();
  });

  it("returns 'Votación no encontrada.' when the voting is missing", async () => {
    setupTables({ votings: { select: { data: [] } } });

    const result = await castVote({
      voting_id: VOTING_ID,
      option_id: OPTION_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Votación no encontrada.");
  });

  it("rejects a second vote for the same user", async () => {
    const builders = setupTables({
      votings: { select: { data: [{ is_open: true, voting_deadline: null }] } },
      voting_options: { select: { data: [{ id: OPTION_ID }] } },
      voting_votes: { select: { data: [{ id: "vote-1" }] } },
    });

    const result = await castVote({
      voting_id: VOTING_ID,
      option_id: OPTION_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Ya has votado en esta votación.");
    expect(builders.voting_votes.eq).toHaveBeenCalledWith("user_id", "actor-1");
    expect(builders.voting_votes.insert).not.toHaveBeenCalled();
  });

  it("maps a 23505 insert violation (race) to a friendly message", async () => {
    const builders = setupTables({
      votings: { select: { data: [{ is_open: true, voting_deadline: null }] } },
      voting_options: { select: { data: [{ id: OPTION_ID }] } },
      voting_votes: {
        select: { data: [] },
        awaited: { error: duplicateKeyError() },
      },
    });

    const result = await castVote({
      voting_id: VOTING_ID,
      option_id: OPTION_ID,
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Ya has votado en esta votación.");
    expect(builders.voting_votes.insert).toHaveBeenCalledTimes(1);
  });

  it("records the vote using the authenticated user id, never the input", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor("member"));
    const builders = setupTables({
      votings: { select: { data: [{ is_open: true, voting_deadline: null }] } },
      voting_options: { select: { data: [{ id: OPTION_ID }] } },
      voting_votes: {
        select: { data: [] },
        awaited: { data: null, error: null },
      },
    });

    const result = await castVote({
      voting_id: VOTING_ID,
      option_id: OTHER_OPTION_ID,
    });

    expect(result).toEqual({ success: true });
    expect(builders.voting_votes.insert).toHaveBeenCalledWith({
      voting_id: VOTING_ID,
      option_id: OTHER_OPTION_ID,
      user_id: "actor-1",
    });
  });
});

// ── closeVoting ────────────────────────────────────────

describe("closeVoting", () => {
  it("rejects non-management members", async () => {
    vi.mocked(requireAuthenticatedProfile).mockResolvedValue(actor("member"));

    const result = await closeVoting({ voting_id: VOTING_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Solo la directiva puede cerrar votaciones.");
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("closes the voting", async () => {
    const builders = setupTables({
      votings: { select: { data: [{ id: "vot-1" }] } },
    });

    const result = await closeVoting({ voting_id: VOTING_ID });

    expect(result).toEqual({ success: true });
    expect(builders.votings.update).toHaveBeenCalledWith({ is_open: false });
    expect(builders.votings.eq).toHaveBeenCalledWith("id", VOTING_ID);
  });

  it("returns 'Votación no encontrada.' when the voting is missing", async () => {
    setupTables({ votings: { select: { data: [] } } });

    const result = await closeVoting({ voting_id: VOTING_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe("Votación no encontrada.");
  });
});