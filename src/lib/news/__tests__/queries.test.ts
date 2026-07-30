import { describe, it, expect, vi, beforeEach } from "vitest";
import { getNewsFeed, getNewsById, getPinnedNews } from "@/lib/news/queries";

// ── Mock the supabase server client ───────────────────

/**
 * Creates a mock Supabase query builder for a given table.
 * All chainable methods (select, order, eq, in) return the builder itself.
 * The builder is thenable: `await builder` resolves to `{ data, error }`.
 */
function makeTableMock(result: { data: unknown[]; error: Error | null } = { data: [], error: null }) {
  // Create a thenable (Promise-like) result
  const thenableResult = Promise.resolve(result);

  // The spies for terminal methods
  const orderSpy = vi.fn(() => builder);
  const eqSpy = vi.fn(() => builder);
  const inSpy = vi.fn(() => builder);
  const maybeSingleSpy = vi.fn(
    () => Promise.resolve(Array.isArray(result.data) ? { data: result.data[0] ?? null, error: result.error } : result),
  );
  const singleSpy = vi.fn(
    () => Promise.resolve(Array.isArray(result.data) ? { data: result.data[0] ?? null, error: result.error } : result),
  );

  // The builder is an object with chainable methods.
  // It also has a `then` method so `await builder` works.
  const builder = {
    select: vi.fn(() => builder),
    order: orderSpy,
    eq: eqSpy,
    in: inSpy,
    maybeSingle: maybeSingleSpy,
    single: singleSpy,
    // Make the builder thenable — `await` resolves to the result
    then: thenableResult.then.bind(thenableResult),
    catch: thenableResult.catch.bind(thenableResult),
    finally: thenableResult.finally.bind(thenableResult),
  };

  return builder;
}

const mockFrom = vi.fn();
vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(() => ({ from: mockFrom })),
}));

function setupMock(options: {
  news?: { data?: unknown[]; error?: Error | null };
  profiles?: { data?: unknown[]; error?: Error | null };
}) {
  const newsResult = { data: options.news?.data ?? [], error: options.news?.error ?? null };
  const profileResult = { data: options.profiles?.data ?? [], error: options.profiles?.error ?? null };

  const newsBuilder = makeTableMock(newsResult);
  const profileBuilder = makeTableMock(profileResult);

  mockFrom.mockImplementation((table: string) => {
    if (table === "profiles") return profileBuilder;
    return newsBuilder;
  });

  return { newsBuilder, profileBuilder };
}

// ── Sample data ───────────────────────────────────────

const sampleNewsRows = [
  {
    id: "1",
    title: "Noticia destacada",
    content: "Contenido de la noticia destacada.",
    image_url: null,
    published: true,
    pinned: true,
    created_by: "user-1",
    created_at: "2026-07-30T10:00:00Z",
  },
  {
    id: "2",
    title: "Noticia reciente",
    content: "Contenido de la noticia reciente.",
    image_url: "https://example.com/img.jpg",
    published: true,
    pinned: false,
    created_by: "user-1",
    created_at: "2026-07-29T10:00:00Z",
  },
  {
    id: "3",
    title: "Borrador sin publicar",
    content: "Contenido del borrador.",
    image_url: null,
    published: false,
    pinned: false,
    created_by: "user-2",
    created_at: "2026-07-28T10:00:00Z",
  },
];

const sampleProfiles = [
  { id: "user-1", first_name: "Admin", last_name: "Umsuka" },
  { id: "user-2", first_name: "Editor", last_name: "Umsuka" },
];

// ── Tests ─────────────────────────────────────────────

describe("getNewsFeed", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only published news when includeUnpublished is false", async () => {
    const publishedRows = sampleNewsRows.filter((r) => r.published);
    setupMock({
      news: { data: publishedRows },
      profiles: { data: sampleProfiles },
    });

    const result = await getNewsFeed(false);
    expect(result).toHaveLength(2);
    expect(result[0].authorFirstName).toBe("Admin");
    expect(result[1].authorFirstName).toBe("Admin");
  });

  it("returns all news when includeUnpublished is true", async () => {
    setupMock({
      news: { data: sampleNewsRows },
      profiles: { data: sampleProfiles },
    });

    const result = await getNewsFeed(true);
    expect(result).toHaveLength(3);
  });

  it("returns empty array when no news exist", async () => {
    setupMock({ news: { data: [] } });

    const result = await getNewsFeed(true);
    expect(result).toEqual([]);
  });

  it("throws error when supabase query fails", async () => {
    setupMock({ news: { data: [], error: new Error("DB error") } });

    await expect(getNewsFeed(true)).rejects.toThrow("Error al obtener noticias");
  });

  it("maps profiles correctly to author fields", async () => {
    const rows = [sampleNewsRows[0]];
    setupMock({
      news: { data: rows },
      profiles: { data: [sampleProfiles[0]] },
    });

    const result = await getNewsFeed(true);
    expect(result[0].authorFirstName).toBe("Admin");
    expect(result[0].authorLastName).toBe("Umsuka");
  });

  it("uses fallback names when profile not found", async () => {
    const rows = [{ ...sampleNewsRows[0], created_by: "unknown-user" }];
    setupMock({
      news: { data: rows },
      profiles: { data: [] },
    });

    const result = await getNewsFeed(true);
    expect(result[0].authorFirstName).toBe("Miembro");
    expect(result[0].authorLastName).toBe("");
  });
});

describe("getNewsById", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the news item when found with includeUnpublished=true", async () => {
    const row = sampleNewsRows[0];
    setupMock({
      news: { data: [row] },
      profiles: { data: [sampleProfiles[0]] },
    });

    const result = await getNewsById("1", true);
    expect(result).not.toBeNull();
    expect(result?.id).toBe("1");
    expect(result?.title).toBe("Noticia destacada");
    expect(result?.authorFirstName).toBe("Admin");
  });

  it("filters unpublished when includeUnpublished=false", async () => {
    setupMock({
      news: { data: [] },
      profiles: { data: [] },
    });

    const result = await getNewsById("3", false);
    expect(result).toBeNull();
  });

  it("returns null when item not found", async () => {
    setupMock({ news: { data: [] } });

    const result = await getNewsById("nonexistent", true);
    expect(result).toBeNull();
  });

  it("throws error on query failure", async () => {
    setupMock({ news: { data: [], error: new Error("DB error") } });

    await expect(getNewsById("1", true)).rejects.toThrow("Error al obtener noticia");
  });
});

describe("getPinnedNews", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only published + pinned news", async () => {
    const pinnedRows = sampleNewsRows.filter((r) => r.published && r.pinned);
    setupMock({
      news: { data: pinnedRows },
      profiles: { data: sampleProfiles },
    });

    const result = await getPinnedNews();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("1");
    expect(result[0].pinned).toBe(true);
    expect(result[0].published).toBe(true);
    expect(result[0].authorFirstName).toBe("Admin");
  });

  it("returns empty array when no pinned news", async () => {
    setupMock({ news: { data: [] } });

    const result = await getPinnedNews();
    expect(result).toEqual([]);
  });
});
