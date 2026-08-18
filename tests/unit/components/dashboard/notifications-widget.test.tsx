import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationsWidget } from "@/components/dashboard/notifications-widget";
import type { NotificationItem } from "@/lib/notifications/schema";

// ── Mocks (UI-focused test: hook data is scripted) ─────

const mockUseUnreadCount = vi.fn();
const mockUseRecentNotifications = vi.fn();
const mockUseMarkAllAsRead = vi.fn();

vi.mock("@/lib/notifications/hooks", () => ({
  useUnreadCount: (...args: unknown[]) => mockUseUnreadCount(...args),
  useRecentNotifications: (...args: unknown[]) => mockUseRecentNotifications(...args),
  useMarkAllAsRead: (...args: unknown[]) => mockUseMarkAllAsRead(...args),
}));

const USER_ID = "323e4567-e89b-12d3-a456-426614174000";

const NOTIFICATIONS: NotificationItem[] = [
  {
    id: "n1",
    userId: USER_ID,
    title: "Nuevo evento: Ensayo de carnaval",
    message: "Sábado 15:00 en la sede",
    type: "event_created",
    isRead: false,
    link: "/events/e1",
    createdAt: "2026-08-17T10:00:00.000Z",
  },
  {
    id: "n2",
    userId: USER_ID,
    title: "Turno asignado: Barra principal",
    message: "Ensayo general",
    type: "shift_assigned",
    isRead: false,
    link: "/events/e1",
    createdAt: "2026-08-16T10:00:00.000Z",
  },
  {
    id: "n3",
    userId: USER_ID,
    title: "Nueva votación: ¿Dónde ensayamos?",
    message: null,
    type: "voting_created",
    isRead: false,
    link: "/votings/v1",
    createdAt: "2026-08-15T10:00:00.000Z",
  },
  {
    id: "n4",
    userId: USER_ID,
    title: "Nueva noticia: Convocatoria",
    message: null,
    type: "news_created",
    isRead: true,
    link: "/news/n1",
    createdAt: "2026-08-14T10:00:00.000Z",
  },
  {
    id: "n5",
    userId: USER_ID,
    title: "Recordatorio: Carnaval",
    message: null,
    type: "event_created",
    isRead: true,
    link: "/events/e2",
    createdAt: "2026-08-13T10:00:00.000Z",
  },
];

/** Mutable "server" state so the mark-all click can update the UI. */
let unreadCount = 3;
const markAllMutate = vi.fn(() => {
  unreadCount = 0;
});

beforeEach(() => {
  vi.clearAllMocks();
  unreadCount = 3;
  // Implementation (not returnValue): the count must be read on every call
  // so the mark-all click updates the badge on the next render.
  mockUseUnreadCount.mockImplementation(() => ({ data: unreadCount }));
  mockUseRecentNotifications.mockReturnValue({ data: NOTIFICATIONS });
  mockUseMarkAllAsRead.mockReturnValue({
    mutate: markAllMutate,
    isPending: false,
  });
});

// ── Tests ──────────────────────────────────────────────

describe("NotificationsWidget", () => {
  it("renders the section title", () => {
    render(<NotificationsWidget userId={USER_ID} />);
    expect(screen.getByText("Notificaciones")).toBeInTheDocument();
  });

  it("shows the unread count in the badge", () => {
    render(<NotificationsWidget userId={USER_ID} />);
    expect(screen.getByText("3 nuevas")).toBeInTheDocument();
  });

  it("does not show the badge when there are no unread notifications", () => {
    mockUseUnreadCount.mockReturnValue({ data: 0 });
    render(<NotificationsWidget userId={USER_ID} />);
    expect(screen.queryByText(/nuevas?/)).not.toBeInTheDocument();
  });

  it("renders the 'Mark all read' button when there are unread items", () => {
    render(<NotificationsWidget userId={USER_ID} />);
    expect(screen.getByText("Marcar todas leídas")).toBeInTheDocument();
  });

  it("hides the 'Mark all read' button when everything is already read", () => {
    mockUseUnreadCount.mockReturnValue({ data: 0 });
    render(<NotificationsWidget userId={USER_ID} />);
    expect(screen.queryByText("Marcar todas leídas")).not.toBeInTheDocument();
  });

  it("marks all notifications as read when 'Mark all read' is clicked", async () => {
    const user = userEvent.setup();
    const view = render(<NotificationsWidget userId={USER_ID} />);

    await user.click(screen.getByText("Marcar todas leídas"));

    expect(markAllMutate).toHaveBeenCalledTimes(1);

    // After the mutation, the mocked hook reports 0 unread: the badge and
    // the button disappear on the next render.
    view.rerender(<NotificationsWidget userId={USER_ID} />);
    expect(screen.queryByText(/nuevas?/)).not.toBeInTheDocument();
    expect(screen.queryByText("Marcar todas leídas")).not.toBeInTheDocument();
  });

  it("renders notification titles", () => {
    render(<NotificationsWidget userId={USER_ID} />);
    expect(screen.getByText("Nuevo evento: Ensayo de carnaval")).toBeInTheDocument();
    expect(screen.getByText("Turno asignado: Barra principal")).toBeInTheDocument();
    expect(screen.getByText("Nueva votación: ¿Dónde ensayamos?")).toBeInTheDocument();
    expect(screen.getByText("Recordatorio: Carnaval")).toBeInTheDocument();
  });

  it("renders up to 5 notifications maximum (the hook receives limit 5)", () => {
    // The 5-item cap lives in useRecentNotifications(userId, 5) — the
    // widget renders exactly what the hook returns, so with the real
    // limit the list shows at most 5 items.
    mockUseRecentNotifications.mockReturnValue({
      data: Array.from({ length: 5 }, (_, i) => ({
        ...NOTIFICATIONS[0]!,
        id: `n-${i}`,
        title: `Notificación ${i}`,
      })),
    });
    render(<NotificationsWidget userId={USER_ID} />);
    const listItems = screen.getAllByRole("listitem");
    expect(listItems.length).toBeLessThanOrEqual(5);
  });

  it("shows the empty state when there are no notifications", () => {
    mockUseRecentNotifications.mockReturnValue({ data: [] });
    render(<NotificationsWidget userId={USER_ID} />);
    expect(screen.getByText("No hay notificaciones")).toBeInTheDocument();
  });

  it("passes the user id to the hooks", () => {
    render(<NotificationsWidget userId={USER_ID} />);
    expect(mockUseRecentNotifications).toHaveBeenCalledWith(USER_ID, 5);
    expect(mockUseUnreadCount).toHaveBeenCalledWith(USER_ID);
    expect(mockUseMarkAllAsRead).toHaveBeenCalledWith(USER_ID);
  });
});
