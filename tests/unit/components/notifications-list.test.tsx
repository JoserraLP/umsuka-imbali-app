import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotificationsList } from "@/app/notifications/notifications-list";
import type { NotificationItem } from "@/lib/notifications/schema";

// ── Mocks (UI-focused: actions and hooks are scripted) ──

const mockLoadMore = vi.fn();

vi.mock("@/app/notifications/actions", () => ({
  loadMoreNotificationsAction: (...args: unknown[]) => mockLoadMore(...args),
}));

const mockUseMarkAllAsRead = vi.fn();
const mockUseMarkAsRead = vi.fn();

vi.mock("@/lib/notifications/hooks", () => ({
  useMarkAllAsRead: (...args: unknown[]) => mockUseMarkAllAsRead(...args),
  useMarkAsRead: (...args: unknown[]) => mockUseMarkAsRead(...args),
}));

// next/link needs a router context in tests; render a plain anchor instead.
vi.mock("next/link", () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}));

const USER_ID = "323e4567-e89b-12d3-a456-426614174000";

function makeNotification(id: string, isRead: boolean): NotificationItem {
  return {
    id,
    userId: USER_ID,
    title: `Notificación ${id}`,
    message: null,
    type: "event_created",
    isRead,
    link: null,
    createdAt: "2026-08-17T10:00:00.000Z",
  };
}

function makeInitialPage(): NotificationItem[] {
  return [
    ...Array.from({ length: 30 }, (_, i) => makeNotification(`u-${i}`, false)),
    ...Array.from({ length: 20 }, (_, i) => makeNotification(`r-${i}`, true)),
  ];
}

const markReadMutate = vi.fn();
const markAllMutate = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  mockUseMarkAsRead.mockReturnValue({ mutate: markReadMutate, isPending: false });
  mockUseMarkAllAsRead.mockReturnValue({ mutate: markAllMutate, isPending: false });
});

describe("NotificationsList", () => {
  it("groups the initial page into unread/read sections and shows the load-more button", () => {
    render(<NotificationsList userId={USER_ID} initialNotifications={makeInitialPage()} />);

    expect(screen.getByText("No leídas (30)")).toBeInTheDocument();
    expect(screen.getByText("Leídas (20)")).toBeInTheDocument();
    expect(screen.getByText("Cargar más")).toBeInTheDocument();
  });

  it("appends the next page and hides the button when the server returns fewer than the page size", async () => {
    const user = userEvent.setup();
    mockLoadMore.mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => makeNotification(`m-${i}`, true)),
    );

    render(<NotificationsList userId={USER_ID} initialNotifications={makeInitialPage()} />);

    await user.click(screen.getByText("Cargar más"));

    await waitFor(() => expect(screen.getByText("Leídas (45)")).toBeInTheDocument());
    expect(mockLoadMore).toHaveBeenCalledWith(50);
    expect(screen.queryByText("Cargar más")).not.toBeInTheDocument();
  });

  it("keeps the button visible when the next page is full", async () => {
    const user = userEvent.setup();
    mockLoadMore.mockResolvedValue(
      Array.from({ length: 50 }, (_, i) => makeNotification(`m-${i}`, true)),
    );

    render(<NotificationsList userId={USER_ID} initialNotifications={makeInitialPage()} />);

    await user.click(screen.getByText("Cargar más"));

    await waitFor(() => expect(screen.getByText("Leídas (70)")).toBeInTheDocument());
    // The button stays but re-renders as "Cargando…" during the transition,
    // then flips back once the transition completes.
    await waitFor(() => expect(screen.getByText("Cargar más")).toBeInTheDocument());
    expect(mockLoadMore).toHaveBeenCalledWith(50);
  });

  it("marks a single notification as read optimistically", async () => {
    const user = userEvent.setup();

    render(<NotificationsList userId={USER_ID} initialNotifications={makeInitialPage()} />);

    // The unread rows come first; click the "Leída" button of the first one.
    const firstReadButton = screen.getAllByText("Leída")[0]!;
    await user.click(firstReadButton);

    expect(markReadMutate).toHaveBeenCalledWith(
      "u-0",
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    await waitFor(() => expect(screen.getByText("No leídas (29)")).toBeInTheDocument());
    expect(screen.getByText("Leídas (21)")).toBeInTheDocument();
  });

  it("marks all notifications as read optimistically", async () => {
    const user = userEvent.setup();

    render(<NotificationsList userId={USER_ID} initialNotifications={makeInitialPage()} />);

    await user.click(screen.getByText("Marcar todas como leídas"));

    expect(markAllMutate).toHaveBeenCalledWith(
      undefined,
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    await waitFor(() => expect(screen.queryByText(/No leídas/)).not.toBeInTheDocument());
    expect(screen.getByText("Leídas (50)")).toBeInTheDocument();
  });

  it("shows the empty state when there is nothing to show", () => {
    render(<NotificationsList userId={USER_ID} initialNotifications={[]} />);

    expect(screen.getByText("No hay notificaciones")).toBeInTheDocument();
    expect(screen.queryByText("Cargar más")).not.toBeInTheDocument();
  });
});
