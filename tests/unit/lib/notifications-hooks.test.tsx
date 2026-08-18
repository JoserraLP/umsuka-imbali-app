import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mocks (hoisted above the imports below by vitest) ──

const mockCreateClient = vi.fn();

vi.mock("@/lib/supabase/client", () => ({
  createClient: (...args: unknown[]) => mockCreateClient(...args),
}));

vi.mock("@/app/notifications/actions", () => ({
  markNotificationReadAction: vi.fn(),
  markAllNotificationsReadAction: vi.fn(),
}));

import { markAllNotificationsReadAction } from "@/app/notifications/actions";
import {
  UNREAD_KEY,
  RECENT_KEY,
  useUnreadCount,
  useNotificationsRealtime,
  useMarkAllAsRead,
} from "@/lib/notifications/hooks";

const USER_ID = "323e4567-e89b-12d3-a456-426614174000";

// ── Helpers ────────────────────────────────────────────

function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
}

function makeWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

/** Chainable stub for awaited query chains (`.select().eq().eq()`). */
function makeQueryStub(result: {
  data?: unknown[] | null;
  count?: number | null;
  error?: Error | null;
}) {
  const thenValue = {
    data: result.data ?? null,
    count: result.count ?? null,
    error: result.error ?? null,
  };
  const thenable = Promise.resolve(thenValue);

  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: thenable.then.bind(thenable),
    catch: thenable.catch.bind(thenable),
    finally: thenable.finally.bind(thenable),
  };
  return builder;
}

interface ChannelStub {
  on: ReturnType<typeof vi.fn>;
  subscribe: ReturnType<typeof vi.fn>;
}

/** Stub of the Realtime channel returned by `.channel(name).on(...).subscribe(...)`. */
function makeChannelStub(): ChannelStub {
  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn(() => channel),
  };
  return channel;
}

function setupRealtimeClient() {
  const channel = makeChannelStub();
  const channelFn = vi.fn(() => channel);
  const removeChannel = vi.fn();
  mockCreateClient.mockReturnValue({
    channel: channelFn,
    removeChannel,
  });
  return { channelFn, channel, removeChannel };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ── useUnreadCount ─────────────────────────────────────

describe("useUnreadCount", () => {
  it("performs the head-only count query scoped to the user", async () => {
    const builder = makeQueryStub({ count: 4 });
    mockCreateClient.mockReturnValue({ from: vi.fn(() => builder) });

    const { result } = renderHook(() => useUnreadCount(USER_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.data).toBe(4));
    expect(builder.select).toHaveBeenCalledWith("id", { count: "exact", head: true });
    expect(builder.eq).toHaveBeenCalledWith("user_id", USER_ID);
    expect(builder.eq).toHaveBeenCalledWith("is_read", false);
  });

  it("falls back to 0 when the query errors", async () => {
    mockCreateClient.mockReturnValue({
      from: vi.fn(() => makeQueryStub({ error: new Error("boom") })),
    });

    const { result } = renderHook(() => useUnreadCount(USER_ID), {
      wrapper: makeWrapper(createTestQueryClient()),
    });

    await waitFor(() => expect(result.current.data).toBe(0));
  });
});

// ── useNotificationsRealtime ───────────────────────────

describe("useNotificationsRealtime", () => {
  it("subscribes to the user-scoped channel with the own-rows filter", () => {
    const { channelFn, channel } = setupRealtimeClient();
    const queryClient = createTestQueryClient();

    renderHook(() => useNotificationsRealtime(USER_ID), { wrapper: makeWrapper(queryClient) });

    expect(channelFn).toHaveBeenCalledWith(`notifications:${USER_ID}`);
    expect(channel.on).toHaveBeenCalledWith(
      "postgres_changes",
      {
        event: "*",
        schema: "umsuka",
        table: "notifications",
        filter: `user_id=eq.${USER_ID}`,
      },
      expect.any(Function),
    );
    expect(channel.subscribe).toHaveBeenCalledWith(expect.any(Function));
  });

  it("invalidates the unread count and recent list when a change arrives", () => {
    const { channel } = setupRealtimeClient();
    const queryClient = createTestQueryClient();
    queryClient.setQueryData([...UNREAD_KEY, USER_ID], 3);
    queryClient.setQueryData([...RECENT_KEY, USER_ID, 5], []);

    renderHook(() => useNotificationsRealtime(USER_ID), { wrapper: makeWrapper(queryClient) });

    const changeCallback = channel.on.mock.calls[0]?.[2] as () => void;
    expect(changeCallback).toBeTypeOf("function");

    act(() => changeCallback());

    expect(queryClient.getQueryState([...UNREAD_KEY, USER_ID])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState([...RECENT_KEY, USER_ID, 5])?.isInvalidated).toBe(true);
  });

  it("removes the channel on unmount", () => {
    const { channel, removeChannel } = setupRealtimeClient();
    const queryClient = createTestQueryClient();

    const { unmount } = renderHook(() => useNotificationsRealtime(USER_ID), {
      wrapper: makeWrapper(queryClient),
    });

    unmount();

    expect(removeChannel).toHaveBeenCalledWith(channel);
  });

  it("logs a warning (no crash) when the channel closes", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { channel } = setupRealtimeClient();
    // The subscription callback is invoked with CLOSED by the channel.
    channel.subscribe.mockImplementation((statusCallback: (status: string) => void) => {
      statusCallback("CLOSED");
      return channel;
    });
    const queryClient = createTestQueryClient();

    renderHook(() => useNotificationsRealtime(USER_ID), { wrapper: makeWrapper(queryClient) });

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining(`canal notifications:${USER_ID} no disponible`),
    );
    warnSpy.mockRestore();
  });
});

// ── useMarkAllAsRead ───────────────────────────────────

describe("useMarkAllAsRead", () => {
  it("calls the server action and invalidates both keys on success", async () => {
    vi.mocked(markAllNotificationsReadAction).mockResolvedValue({ success: true });
    const queryClient = createTestQueryClient();
    queryClient.setQueryData([...UNREAD_KEY, USER_ID], 3);
    queryClient.setQueryData([...RECENT_KEY, USER_ID, 5], []);

    const { result } = renderHook(() => useMarkAllAsRead(USER_ID), {
      wrapper: makeWrapper(queryClient),
    });

    await act(async () => {
      await result.current.mutateAsync();
    });

    expect(markAllNotificationsReadAction).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryState([...UNREAD_KEY, USER_ID])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState([...RECENT_KEY, USER_ID, 5])?.isInvalidated).toBe(true);
  });
});
