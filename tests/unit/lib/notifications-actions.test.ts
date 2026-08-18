import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mocks (hoisted above the imports below by vitest) ──

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/auth/session", () => ({
  getCurrentProfile: vi.fn(),
}));

vi.mock("@/lib/notifications/queries", () => ({
  getMyNotifications: vi.fn(),
}));

import { getCurrentProfile } from "@/lib/auth/session";
import { getMyNotifications } from "@/lib/notifications/queries";
import { loadMoreNotificationsAction } from "@/app/notifications/actions";
import { NOTIFICATIONS_PAGE_SIZE, type NotificationItem } from "@/lib/notifications/schema";

const mockGetCurrentProfile = vi.mocked(getCurrentProfile);
const mockGetMyNotifications = vi.mocked(getMyNotifications);

const USER_ID = "323e4567-e89b-12d3-a456-426614174000";

function makeNotification(id: string): NotificationItem {
  return {
    id,
    userId: USER_ID,
    title: `Notificación ${id}`,
    message: null,
    type: "event_created",
    isRead: false,
    link: null,
    createdAt: "2026-08-17T10:00:00.000Z",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetCurrentProfile.mockResolvedValue({
    id: USER_ID,
  } as Awaited<ReturnType<typeof getCurrentProfile>>);
});

describe("loadMoreNotificationsAction", () => {
  it("loads the next page for the authenticated user (server-side id)", async () => {
    const items = [makeNotification("n51"), makeNotification("n52")];
    mockGetMyNotifications.mockResolvedValue(items);

    const result = await loadMoreNotificationsAction(50);

    expect(result).toEqual(items);
    expect(mockGetMyNotifications).toHaveBeenCalledWith(USER_ID, {
      limit: NOTIFICATIONS_PAGE_SIZE,
      offset: 50,
    });
  });

  it("rejects a negative offset without querying", async () => {
    await expect(loadMoreNotificationsAction(-1)).rejects.toThrow(
      "El desplazamiento debe ser un número positivo.",
    );
    expect(mockGetMyNotifications).not.toHaveBeenCalled();
  });

  it("rejects a non-integer offset without querying", async () => {
    await expect(loadMoreNotificationsAction(10.5)).rejects.toThrow(
      "El desplazamiento debe ser un número entero.",
    );
    expect(mockGetMyNotifications).not.toHaveBeenCalled();
  });

  it("rejects an offset above the hard cap (5000) without querying", async () => {
    await expect(loadMoreNotificationsAction(5001)).rejects.toThrow(
      "El desplazamiento supera el límite permitido.",
    );
    expect(mockGetMyNotifications).not.toHaveBeenCalled();
  });

  it("rejects an offset at the cap (5000 is allowed)", async () => {
    mockGetMyNotifications.mockResolvedValue([]);

    await expect(loadMoreNotificationsAction(5000)).resolves.toEqual([]);
    expect(mockGetMyNotifications).toHaveBeenCalledWith(USER_ID, {
      limit: NOTIFICATIONS_PAGE_SIZE,
      offset: 5000,
    });
  });

  it("throws when there is no authenticated session", async () => {
    mockGetCurrentProfile.mockResolvedValue(null);

    await expect(loadMoreNotificationsAction(50)).rejects.toThrow("Se requiere autenticación.");
    expect(mockGetMyNotifications).not.toHaveBeenCalled();
  });
});
