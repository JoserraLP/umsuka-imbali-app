import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationsWidget } from "@/components/dashboard/notifications-widget";

describe("NotificationsWidget", () => {
  it("renders the section title", () => {
    render(<NotificationsWidget />);
    expect(screen.getByText("Notificaciones")).toBeInTheDocument();
  });

  it("renders mock notifications", () => {
    render(<NotificationsWidget />);
    // Should show the unread badge count
    expect(screen.getByText(/nuevas/)).toBeInTheDocument();
  });

  it("shows unread count in the badge", () => {
    render(<NotificationsWidget />);
    const badge = screen.getByText(/nuevas/);
    expect(badge).toBeInTheDocument();
  });

  it("renders the 'Mark all read' button when there are unread items", () => {
    render(<NotificationsWidget />);
    const markAllButton = screen.getByText("Marcar todas leídas");
    expect(markAllButton).toBeInTheDocument();
  });

  it("marks all notifications as read when 'Mark all read' is clicked", async () => {
    const user = userEvent.setup();
    render(<NotificationsWidget />);

    // Click "Marcar todas leídas"
    await user.click(screen.getByText("Marcar todas leídas"));

    // The badge with unread count should disappear
    expect(screen.queryByText(/nuevas/)).not.toBeInTheDocument();

    // The "Mark all read" button should disappear
    expect(screen.queryByText("Marcar todas leídas")).not.toBeInTheDocument();
  });

  it("renders notification titles", () => {
    render(<NotificationsWidget />);
    // Should render at least one notification title
    const titles = screen.getAllByText(/Nuevo|Asignación|Recordatorio|Solicitud/);
    expect(titles.length).toBeGreaterThan(0);
  });

  it("renders up to 5 notifications maximum", () => {
    render(<NotificationsWidget />);
    const listItems = screen.getAllByRole("listitem");
    expect(listItems.length).toBeLessThanOrEqual(5);
  });
});
