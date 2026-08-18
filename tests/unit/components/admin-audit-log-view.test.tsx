import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  AuditLogView,
  buildPageHref,
} from "@/app/admin/audit/audit-log-view";
import { auditLogFiltersSchema, type AuditLogItem, type AuditLogFilters } from "@/lib/admin/schema";

// next/link needs a router context in tests; render a plain anchor instead.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const ACTOR = "123e4567-e89b-12d3-a456-426614174000";
const TARGET = "323e4567-e89b-12d3-a456-426614174000";

function makeItem(id: string, action: AuditLogItem["action"]): AuditLogItem {
  return {
    id,
    userId: ACTOR,
    actorName: "Ada Lovelace",
    action,
    entityType: "profile",
    entityId: TARGET,
    details: null,
    createdAt: "2026-08-18T10:00:00.000Z",
  };
}

function emptyFilters(): AuditLogFilters {
  return {
    user: undefined,
    action: undefined,
    from: undefined,
    to: undefined,
    page: 1,
    offset: 0,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("AuditLogView", () => {
  it("renders the audit rows with actor name, action label and date", () => {
    render(
      <AuditLogView
        items={[
          makeItem("log-1", "user.role_changed"),
          makeItem("log-2", "user.approved"),
        ]}
        total={2}
        hasMore={false}
        initialFilters={emptyFilters()}
      />,
    );

    expect(screen.getAllByText("Ada Lovelace").length).toBe(2);
    expect(screen.getAllByText("Rol cambiado").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("Cuenta aprobada").length).toBeGreaterThanOrEqual(1);
    // Date rendered in Spanish, e.g. 18 ago 2026.
    expect(screen.getAllByText(/18 ago 2026/).length).toBe(2);
  });

  it("renders the action filter select with all 13 actions plus 'Todas'", () => {
    render(
      <AuditLogView
        items={[makeItem("log-1", "user.role_changed")]}
        total={1}
        hasMore={false}
        initialFilters={emptyFilters()}
      />,
    );

    const select = screen.getByLabelText(/Acción/);
    expect(select).toBeInTheDocument();
    const options = Array.from(select.querySelectorAll("option")).map((o) => o.textContent);
    expect(options).toContain("Todas");
    expect(options).toContain("Rol cambiado");
    expect(options).toContain("Cuenta suspendida");
    expect(options).toContain("Configuración actualizada");
    expect(options?.length).toBe(14); // "Todas" + 13 actions
  });

  it("preselects the current filters from the URL", () => {
    render(
      <AuditLogView
        items={[makeItem("log-1", "user.suspended")]}
        total={1}
        hasMore={false}
        initialFilters={{
          user: undefined,
          action: "user.suspended",
          from: "2026-08-01",
          to: "2026-08-18",
          page: 1,
          offset: 0,
        }}
      />,
    );

    expect(screen.getByLabelText(/Acción/)).toHaveValue("user.suspended");
    expect(screen.getByLabelText(/Desde/)).toHaveValue("2026-08-01");
    expect(screen.getByLabelText(/Hasta/)).toHaveValue("2026-08-18");
  });

  it("links the pagination controls with the current filters and page", () => {
    render(
      <AuditLogView
        items={[makeItem("log-1", "user.role_changed")]}
        total={51}
        hasMore={true}
        initialFilters={{
          user: undefined,
          action: "user.role_changed",
          from: undefined,
          to: undefined,
          page: 1,
          offset: 0,
        }}
      />,
    );

    const nextLink = screen.getByRole("link", { name: /Siguiente/ });
    expect(nextLink.getAttribute("href")).toBe(
      "/admin/audit?action=user.role_changed&page=2",
    );
  });

  it("disables pagination when there is no next page", () => {
    render(
      <AuditLogView
        items={[makeItem("log-1", "user.role_changed")]}
        total={1}
        hasMore={false}
        initialFilters={emptyFilters()}
      />,
    );

    expect(screen.getByRole("link", { name: /Siguiente/ }).getAttribute("aria-disabled")).toBe(
      "true",
    );
  });

  it("shows the total count and an empty state when there are no rows", () => {
    render(
      <AuditLogView
        items={[]}
        total={0}
        hasMore={false}
        initialFilters={emptyFilters()}
      />,
    );

    expect(screen.getByText("0 registros")).toBeInTheDocument();
    expect(screen.getByText(/Sin registros/)).toBeInTheDocument();
  });

  it("renders 'Usuario eliminado' as the actor fallback", () => {
    render(
      <AuditLogView
        items={[{ ...makeItem("log-1", "user.suspended"), actorName: "Usuario eliminado" }]}
        total={1}
        hasMore={false}
        initialFilters={emptyFilters()}
      />,
    );

    expect(screen.getByText("Usuario eliminado")).toBeInTheDocument();
  });
});

// ── M1 regression: filter round-trip through the URL ─────

describe("buildPageHref round-trip (M1 regression)", () => {
  it("re-parses the generated searchParams preserving every filter (incl. to as raw date)", () => {
    const filters: AuditLogFilters = {
      user: "123e4567-e89b-12d3-a456-426614174000",
      action: "user.suspended",
      from: "2026-08-01",
      to: "2026-08-18",
      page: 2,
      offset: 50,
    };

    const href = buildPageHref(filters, 3);
    const params = new URL(href, "http://localhost").searchParams;
    const parsed = auditLogFiltersSchema.safeParse({
      user: params.get("user") ?? "",
      action: params.get("action") ?? "",
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
      page: params.get("page") ?? "1",
    });

    expect(parsed.success).toBe(true);
    expect(parsed.data).toMatchObject({
      user: filters.user,
      action: filters.action,
      from: filters.from,
      to: filters.to,
      page: 3,
    });
  });

  it("keeps the raw YYYY-MM-DD 'to' value in the URL (no end-of-day ISO leak)", () => {
    const href = buildPageHref({ ...emptyFilters(), to: "2026-08-18" }, 1);
    expect(new URL(href, "http://localhost").searchParams.get("to")).toBe("2026-08-18");
  });
});