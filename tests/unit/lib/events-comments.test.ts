import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted by vitest) ──────────────────────────

const mockFrom = vi.fn();

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

vi.mock("@/lib/auth/session", () => ({
  requireAuthenticatedProfile: vi.fn(),
}));

import { requireAuthenticatedProfile } from "@/lib/auth/session";
import { addEventComment, deleteEventComment } from "@/lib/events/mutations";

const mockRequireAuthenticatedProfile = vi.mocked(requireAuthenticatedProfile);

const EVENT_ID = "123e4567-e89b-12d3-a456-426614174000";
const COMMENT_ID = "223e4567-e89b-12d3-a456-426614174000";
const ACTOR_ID = "323e4567-e89b-12d3-a456-426614174000";
const OTHER_USER_ID = "423e4567-e89b-12d3-a456-426614174000";

// ── Chain-builder stub (mirrors admin-set-component-lead.test.ts) ──

interface DbResult {
  data?: unknown | unknown[] | null;
  error?: { message: string; code?: string } | null;
  singleData?: unknown;
  maybeSingleData?: unknown;
}

function makeTableMock(result: DbResult = {}) {
  const chainValue = {
    data: Array.isArray(result.data) ? result.data : (result.data ?? null),
    error: result.error ?? null,
  };
  const thenable = Promise.resolve(chainValue);

  const builder = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    order: vi.fn(() => builder),
    maybeSingle: vi.fn(() =>
      Promise.resolve({
        data:
          result.maybeSingleData !== undefined
            ? result.maybeSingleData
            : Array.isArray(result.data)
              ? (result.data[0] ?? null)
              : (result.data ?? null),
        error: result.error ?? null,
      }),
    ),
    single: vi.fn(() =>
      Promise.resolve({
        data:
          result.singleData !== undefined
            ? result.singleData
            : Array.isArray(result.data)
              ? (result.data[0] ?? null)
              : (result.data ?? null),
        error: result.error ?? null,
      }),
    ),
    then: thenable.then.bind(thenable),
    catch: thenable.catch.bind(thenable),
    finally: thenable.finally.bind(thenable),
  };
  return builder;
}

/**
 * Scripts the mock `.from(table)` calls in order. Each step declares the
 * table it expects next, so an implementation bug that queries the wrong
 * table (or one extra query) fails the test loudly.
 */
function setupScript(script: Array<{ table: string; result?: DbResult }>) {
  const builders: ReturnType<typeof makeTableMock>[] = [];
  let index = 0;
  mockFrom.mockImplementation((table: string) => {
    const step = script[index];
    if (!step || step.table !== table) {
      throw new Error(
        `Unexpected table "${table}" at call ${index} (expected "${step?.table ?? "none"}")`,
      );
    }
    index += 1;
    const builder = makeTableMock(step.result);
    builders.push(builder);
    return builder;
  });
  return builders;
}

function actor(role: "member" | "admin" | "board_member" | "super_admin") {
  return {
    id: ACTOR_ID,
    role,
  } as unknown as Awaited<ReturnType<typeof requireAuthenticatedProfile>>;
}

// ── Tests ─────────────────────────────────────────────

describe("addEventComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error for invalid input", async () => {
    const result = await addEventComment({ eventId: "not-a-uuid", body: "Hola" });
    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("inserts a comment owned by the actor and returns the new id", async () => {
    const builders = setupScript([
      { table: "event_comments", result: { singleData: { id: COMMENT_ID } } },
    ]);
    mockRequireAuthenticatedProfile.mockResolvedValue(actor("member"));

    const result = await addEventComment({ eventId: EVENT_ID, body: "  ¡Gran evento!  " });

    expect(result).toEqual({ success: true, id: COMMENT_ID });
    expect(builders[0]!.insert).toHaveBeenCalledWith({
      event_id: EVENT_ID,
      user_id: ACTOR_ID,
      body: "¡Gran evento!",
    });
  });

  it("surfaces database errors verbatim", async () => {
    setupScript([{ table: "event_comments", result: { error: { message: "insert failed" } } }]);
    mockRequireAuthenticatedProfile.mockResolvedValue(actor("member"));

    const result = await addEventComment({ eventId: EVENT_ID, body: "Hola" });
    expect(result.success).toBe(false);
    expect(result.error).toBe("insert failed");
  });
});

describe("deleteEventComment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns an error for invalid input", async () => {
    const result = await deleteEventComment({ eventId: EVENT_ID, commentId: "nope" });
    expect(result.success).toBe(false);
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("lets the author delete their own comment", async () => {
    const builders = setupScript([
      { table: "event_comments", result: { data: [{ user_id: ACTOR_ID }] } },
      { table: "event_comments" },
    ]);
    mockRequireAuthenticatedProfile.mockResolvedValue(actor("member"));

    const result = await deleteEventComment({ eventId: EVENT_ID, commentId: COMMENT_ID });

    expect(result.success).toBe(true);
    expect(builders[1]!.delete).toHaveBeenCalledWith();
    expect(builders[1]!.eq).toHaveBeenCalledWith("id", COMMENT_ID);
  });

  it("lets management delete any comment", async () => {
    setupScript([
      { table: "event_comments", result: { data: [{ user_id: OTHER_USER_ID }] } },
      { table: "event_comments" },
    ]);
    mockRequireAuthenticatedProfile.mockResolvedValue(actor("board_member"));

    const result = await deleteEventComment({ eventId: EVENT_ID, commentId: COMMENT_ID });

    expect(result.success).toBe(true);
  });

  it("rejects a regular member deleting someone else's comment", async () => {
    const builders = setupScript([
      { table: "event_comments", result: { data: [{ user_id: OTHER_USER_ID }] } },
    ]);
    mockRequireAuthenticatedProfile.mockResolvedValue(actor("member"));

    const result = await deleteEventComment({ eventId: EVENT_ID, commentId: COMMENT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toContain("permiso");
    expect(builders[0]!.delete).not.toHaveBeenCalled();
  });

  it("returns a friendly error when the comment does not exist", async () => {
    setupScript([{ table: "event_comments", result: { data: [] } }]);
    mockRequireAuthenticatedProfile.mockResolvedValue(actor("admin"));

    const result = await deleteEventComment({ eventId: EVENT_ID, commentId: COMMENT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toContain("no encontrado");
  });

  it("surfaces database errors from the delete verbatim", async () => {
    setupScript([
      { table: "event_comments", result: { data: [{ user_id: ACTOR_ID }] } },
      { table: "event_comments", result: { error: { message: "delete failed" } } },
    ]);
    mockRequireAuthenticatedProfile.mockResolvedValue(actor("member"));

    const result = await deleteEventComment({ eventId: EVENT_ID, commentId: COMMENT_ID });

    expect(result.success).toBe(false);
    expect(result.error).toBe("delete failed");
  });
});
