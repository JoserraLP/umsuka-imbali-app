import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { getCategories, getDocuments, getDocumentById } from "@/lib/documents/queries";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getCategories", () => {
  it("returns mapped categories ordered by name", async () => {
    const data = [
      { id: "c1", name: "Actas", description: null, parent_id: null, created_by: "u1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" },
    ];
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data, error: null }),
    };
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn(() => mockChain) } as never);

    const res = await getCategories();
    expect(res).toHaveLength(1);
    expect(res[0]!.name).toBe("Actas");
    expect(mockChain.select).toHaveBeenCalledWith("id, name, description, parent_id, created_by, created_at, updated_at");
    expect(mockChain.order).toHaveBeenCalledWith("name", { ascending: true });
  });

  it("throws on error", async () => {
    const mockChain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }),
    };
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn(() => mockChain) } as never);
    await expect(getCategories()).rejects.toThrow("Error al obtener categorías");
  });
});

describe("getDocuments", () => {
  it("applies filters search/category/mime", async () => {
    const data = [
      { id: "d1", category_id: "c1", name: "Estatutos", file_path: "uid/a.pdf", file_size: 1000, mime_type: "application/pdf", uploaded_by: "u1", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", document_categories: { name: "Legal" } },
    ];

    const orderMock = vi.fn().mockResolvedValue({ data, error: null });
    const eqMock = vi.fn().mockReturnThis();
    const ilikeMock = vi.fn().mockReturnThis();

    // Build chain where select -> ilike -> eq -> eq -> order
    const chain: Record<string, ReturnType<typeof vi.fn>> = {
      select: vi.fn().mockReturnThis(),
      ilike: ilikeMock,
      eq: eqMock,
      order: orderMock,
    };
    // Need eq to be chainable and order to resolve; make eq return chain
    chain.select!.mockReturnValue(chain);
    chain.ilike!.mockReturnValue(chain);
    chain.eq!.mockReturnValue(chain);

    vi.mocked(createClient).mockResolvedValue({ from: vi.fn(() => chain) } as never);

    const res = await getDocuments({ search: "Esta", categoryId: "c1", mimeType: "application/pdf" });
    expect(res).toHaveLength(1);
    expect(res[0]!.categoryName).toBe("Legal");
    expect(chain.ilike).toHaveBeenCalledWith("name", "%Esta%");
    expect(chain.eq).toHaveBeenCalledWith("category_id", "c1");
    expect(chain.eq).toHaveBeenCalledWith("mime_type", "application/pdf");
  });

  it("returns empty when no data", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: null }),
      ilike: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
    };
    chain.select.mockReturnValue(chain);
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn(() => chain) } as never);
    const res = await getDocuments();
    expect(res).toEqual([]);
  });

  it("throws on error", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      order: vi.fn().mockResolvedValue({ data: null, error: { message: "fail" } }),
    };
    chain.select.mockReturnValue(chain);
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn(() => chain) } as never);
    await expect(getDocuments()).rejects.toThrow("Error al obtener documentos");
  });
});

describe("getDocumentById", () => {
  it("returns single document", async () => {
    const row = { id: "d1", category_id: null, name: "Doc", file_path: "p.pdf", file_size: 10, mime_type: "application/pdf", uploaded_by: null, created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z", document_categories: null };
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: row, error: null }),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn(() => chain) } as never);
    const res = await getDocumentById("d1");
    expect(res?.id).toBe("d1");
  });

  it("returns null when not found", async () => {
    const chain = {
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    };
    chain.select.mockReturnValue(chain);
    chain.eq.mockReturnValue(chain);
    vi.mocked(createClient).mockResolvedValue({ from: vi.fn(() => chain) } as never);
    const res = await getDocumentById("missing");
    expect(res).toBeNull();
  });
});
