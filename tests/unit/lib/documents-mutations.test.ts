import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/auth/session", () => ({
  getCurrentProfile: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentProfile } from "@/lib/auth/session";
import {
  createCategory,
  updateCategory,
  deleteCategory,
  createDocument,
  updateDocument,
  deleteDocument,
} from "@/lib/documents/mutations";
import type { AuthenticatedProfile } from "@/types/auth";

function actor(role: AuthenticatedProfile["role"] = "super_admin"): AuthenticatedProfile {
  return {
    id: "actor-1",
    firstName: "Marta",
    lastName: "Admin",
    email: "m@example.com",
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

function makeTableMock(selectResult: { data?: unknown; error?: unknown } = {}) {
  const data = selectResult.data ?? null;
  const error = (selectResult.error as Error | null) ?? null;
  const builder: Record<string, Mock> = {
    select: vi.fn(() => builder),
    insert: vi.fn(() => builder),
    update: vi.fn(() => builder),
    delete: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    maybeSingle: vi.fn(() => Promise.resolve({ data, error })),
    single: vi.fn(() => Promise.resolve({ data, error })),
    then: vi.fn(),
  };
  const thenable = Promise.resolve({ data, error });
  builder.then = ((onfulfilled: (v: unknown) => unknown) => thenable.then(onfulfilled as never)) as unknown as Mock;
  return builder;
}

function setupClient(tables: Record<string, { data?: unknown; error?: unknown }> = {}) {
  const builders: Record<string, ReturnType<typeof makeTableMock>> = {};
  for (const [k, v] of Object.entries(tables)) {
    builders[k] = makeTableMock(v);
  }
  const from = vi.fn((table: string) => builders[table] ?? makeTableMock({}));
  vi.mocked(createClient).mockResolvedValue({ from } as never);
  return { from, builders };
}

function setupAdmin(uploadError: Error | null = null, removeError: Error | null = null) {
  const removeMock = vi.fn(() => Promise.resolve({ error: removeError }));
  const uploadMock = vi.fn(() => Promise.resolve({ error: uploadError }));
  const storageFromMock = vi.fn(() => ({
    upload: uploadMock,
    remove: removeMock,
  }));
  vi.mocked(createAdminClient).mockReturnValue({
    storage: { from: storageFromMock },
  } as never);
  return { uploadMock, removeMock, storageFromMock };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentProfile).mockResolvedValue(actor("super_admin"));
  setupAdmin();
  setupClient();
});

describe("createCategory", () => {
  it("rejects non-management without DB call", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(actor("member"));
    const { from } = setupClient();
    const res = await createCategory({ name: "Actas" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Solo la directiva puede gestionar documentos.");
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects unauthenticated", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(null);
    const res = await createCategory({ name: "Actas" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("No autenticado.");
  });

  it("creates category", async () => {
    const { builders } = setupClient({
      document_categories: { data: { id: "cat-1" } },
    });
    const res = await createCategory({ name: "Actas", description: "Desc" });
    expect(res.success).toBe(true);
    expect(builders["document_categories"]!.insert).toHaveBeenCalledWith({
      name: "Actas",
      description: "Desc",
      parent_id: null,
      created_by: "actor-1",
    });
  });

  it("maps 23505 to friendly", async () => {
    setupClient({
      document_categories: { error: Object.assign(new Error("dup"), { code: "23505" }) },
    });
    const res = await createCategory({ name: "Actas" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Ya existe una categoría con ese nombre.");
  });

  it("rejects invalid input before guard? actually validates after guard - returns validation error", async () => {
    const res = await createCategory({ name: "" });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("El nombre de la categoría es obligatorio.");
  });
});

describe("updateCategory / deleteCategory", () => {
  it("update rejects member", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(actor("member"));
    const res = await updateCategory({ id: "123e4567-e89b-12d3-a456-426614174010", name: "X" });
    expect(res.success).toBe(false);
  });

  it("delete succeeds", async () => {
    setupClient({
      document_categories: { data: null },
    });
    const res = await deleteCategory("123e4567-e89b-12d3-a456-426614174010");
    expect(res.success).toBe(true);
  });
});

describe("createDocument", () => {
  function makeFile(name = "doc.pdf", _size = 1000, type = "application/pdf") {
    return new File(["content"], name, { type });
  }

  it("rejects non-management without upload", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(actor("member"));
    const { uploadMock } = setupAdmin();
    const res = await createDocument({ name: "Doc", file: makeFile() });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Solo la directiva puede gestionar documentos.");
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("rejects invalid file size", async () => {
    const empty = new File([], "empty.pdf", { type: "application/pdf" });
    const res = await createDocument({ name: "Doc", file: empty });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toMatch(/Fichero no especificado|no puede estar vacío/);
  });

  it("rejects disallowed mime", async () => {
    const f = new File(["x"], "archive.zip", { type: "application/zip" });
    const res = await createDocument({ name: "Doc", file: f });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toBe("Tipo de fichero no permitido.");
  });

  it("uploads and inserts on success", async () => {
    setupAdmin(null);
    const { builders } = setupClient({
      documents: { data: { id: "doc-1" } },
    });
    const f = makeFile("estatutos.pdf", 1024, "application/pdf");
    Object.defineProperty(f, "size", { value: 1024 });
    const res = await createDocument({ name: "Estatutos", file: f });
    expect(res.success).toBe(true);
    expect(builders["documents"]!.insert).toHaveBeenCalled();
  });

  it("cleanup orphan on DB error", async () => {
    const { removeMock } = setupAdmin(null);
    setupClient({
      documents: { error: Object.assign(new Error("db fail"), { code: "23505" }) },
    });
    const f = makeFile("doc.pdf", 1024, "application/pdf");
    Object.defineProperty(f, "size", { value: 1024 });
    const res = await createDocument({ name: "Doc", file: f });
    expect(res.success).toBe(false);
    expect(removeMock).toHaveBeenCalled();
  });

  it("returns upload error when storage fails", async () => {
    setupAdmin(new Error("storage down") as never);
    setupClient({});
    const f = makeFile("doc.pdf", 1024, "application/pdf");
    Object.defineProperty(f, "size", { value: 1024 });
    const res = await createDocument({ name: "Doc", file: f });
    expect(res.success).toBe(false);
    if (!res.success) expect(res.error).toContain("Error al subir fichero");
  });
});

describe("updateDocument", () => {
  it("rejects member", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(actor("member"));
    const res = await updateDocument({ id: "123e4567-e89b-12d3-a456-426614174011", name: "Nuevo" });
    expect(res.success).toBe(false);
  });

  it("updates when management", async () => {
    const { builders } = setupClient({ documents: { data: null } });
    const res = await updateDocument({ id: "123e4567-e89b-12d3-a456-426614174011", name: "Nuevo" });
    expect(res.success).toBe(true);
    expect(builders["documents"]!.update).toHaveBeenCalled();
  });
});

describe("deleteDocument", () => {
  it("rejects member", async () => {
    vi.mocked(getCurrentProfile).mockResolvedValue(actor("member"));
    const res = await deleteDocument("123e4567-e89b-12d3-a456-426614174011");
    expect(res.success).toBe(false);
  });

  it("deletes and removes storage file", async () => {
    setupClient({
      documents: { data: { file_path: "uid/abc.pdf" } },
    });
    const { removeMock } = setupAdmin();
    const res = await deleteDocument("123e4567-e89b-12d3-a456-426614174011");
    expect(res.success).toBe(true);
    expect(removeMock).toHaveBeenCalledWith(["uid/abc.pdf"]);
  });
});
