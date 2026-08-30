import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BottomNav } from "@/components/layout/bottom-nav";
import { getVisibleLinks } from "@/components/layout/nav-links";
import type { AppRole, ComponentType, Workgroup } from "@/types/database.types";

// next/link needs a router context in tests; render a plain anchor instead.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/dashboard",
}));

// The badge subscribes to realtime hooks; render its children untouched.
vi.mock("@/components/layout/nav-notification-badge", () => ({
  NavNotificationBadge: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

const baseProps = {
  isWorkgroupLead: false,
  workgroup: "ninguno" as Workgroup,
  componentLeadFor: null as ComponentType | null,
  userId: "test-user",
};

const ctxFor = (role: AppRole) => ({
  role,
  isWorkgroupLead: false,
  workgroup: "ninguno" as Workgroup,
  componentLeadFor: null as ComponentType | null,
});

describe("BottomNav", () => {
  it("muestra las 19 secciones para super_admin (ninguna queda inaccesible)", () => {
    render(<BottomNav currentRole="super_admin" {...baseProps} />);

    const labels = getVisibleLinks(ctxFor("super_admin")).map((link) => link.label);
    expect(labels).toHaveLength(22);
    expect(screen.getAllByRole("link")).toHaveLength(labels.length);
    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it("hace el contenedor deslizable horizontalmente con scrollbar oculto", () => {
    const { container } = render(<BottomNav currentRole="member" {...baseProps} />);

    const scroller = container.querySelector("nav > div");
    expect(scroller).not.toBeNull();
    expect(scroller!.className).toContain("overflow-x-auto");
    expect(scroller!.className).toContain("overscroll-x-contain");
    expect(scroller!.className).toContain("[scrollbar-width:none]");
    expect(scroller!.className).toContain("[&::-webkit-scrollbar]:hidden");
  });

  it("mantiene cada sección sin encogerse (shrink-0) para que el swipe no colapse ítems", () => {
    render(<BottomNav currentRole="super_admin" {...baseProps} />);

    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link.className).toContain("shrink-0");
    }
  });

  it("muestra solo las secciones base para un rol miembro", () => {
    render(<BottomNav currentRole="member" {...baseProps} />);

    const labels = getVisibleLinks(ctxFor("member")).map((link) => link.label);
    expect(labels).toHaveLength(11);
    expect(screen.getAllByRole("link")).toHaveLength(labels.length);

    for (const label of labels) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText("Miembros")).not.toBeInTheDocument();
    expect(screen.queryByText("Administración de miembros")).not.toBeInTheDocument();
  });
});