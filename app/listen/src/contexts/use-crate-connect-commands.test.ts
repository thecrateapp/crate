import { renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const {
  acknowledgeConnectCommandMock,
  connectCommandEventsUrlMock,
  emitConnectSessionChangedMock,
  fetchPendingConnectCommandsMock,
} = vi.hoisted(() => ({
  acknowledgeConnectCommandMock: vi.fn(async () => undefined),
  connectCommandEventsUrlMock: vi.fn(
    () => "/api/me/connect/events?device_id=phone",
  ),
  emitConnectSessionChangedMock: vi.fn(),
  fetchPendingConnectCommandsMock: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@/lib/crate-connect", () => ({
  acknowledgeConnectCommand: acknowledgeConnectCommandMock,
  connectCommandEventsUrl: connectCommandEventsUrlMock,
  emitConnectSessionChanged: emitConnectSessionChangedMock,
  fetchPendingConnectCommands: fetchPendingConnectCommandsMock,
}));

import type { AuthUser } from "@/contexts/auth-context";
import { useCrateConnectCommands } from "@/contexts/use-crate-connect-commands";

const AUTH_USER: AuthUser = {
  id: 1,
  email: "diego@test.com",
  name: "Diego",
  role: "admin",
};

class MockEventSource {
  static instances: MockEventSource[] = [];

  onmessage: ((event: MessageEvent) => void) | null = null;
  listeners = new Map<string, Set<EventListener>>();
  close = vi.fn();

  constructor(public url: string) {
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: EventListener) {
    const listeners = this.listeners.get(type) ?? new Set<EventListener>();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  removeEventListener(type: string, listener: EventListener) {
    this.listeners.get(type)?.delete(listener);
  }

  emit(type: string, payload: unknown) {
    const event = { data: JSON.stringify(payload) } as MessageEvent;
    if (type === "message") this.onmessage?.(event);
    this.listeners.get(type)?.forEach((listener) => listener(event));
  }
}

function handlers(
  overrides: Partial<Parameters<typeof useCrateConnectCommands>[0]> = {},
) {
  return {
    authUser: AUTH_USER,
    isBuffering: false,
    isPlaying: false,
    pause: vi.fn(),
    resume: vi.fn(),
    next: vi.fn(),
    prev: vi.fn(),
    seek: vi.fn(),
    setVolume: vi.fn(),
    onTransferIn: vi.fn(),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
  fetchPendingConnectCommandsMock.mockResolvedValue([]);
  MockEventSource.instances = [];
});

describe("useCrateConnectCommands", () => {
  it("applies transfer-in commands and acknowledges once playback is ready", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const opts = handlers();
    const { rerender } = renderHook(
      ({ isPlaying, isBuffering }) =>
        useCrateConnectCommands({
          ...opts,
          isPlaying,
          isBuffering,
        }),
      {
        initialProps: {
          isPlaying: false,
          isBuffering: true,
        },
      },
    );

    const source = MockEventSource.instances[0];
    expect(source?.url).toBe("/api/me/connect/events?device_id=phone");
    source?.emit("connect.command", {
      command_id: "11111111-1111-1111-1111-111111111111",
      type: "transfer_in",
      payload: {
        start_playing: true,
        state: {
          device_id: "phone",
          status: "playing",
          title: "Track",
          artist: "Artist",
          album: "Album",
          position_ms: 1000,
          current_index: 0,
          queue: [{ title: "Track", artist: "Artist" }],
          repeat_mode: "off",
          shuffle: false,
        },
      },
    });

    expect(opts.onTransferIn).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Track" }),
      true,
    );
    expect(acknowledgeConnectCommandMock).not.toHaveBeenCalled();

    rerender({ isPlaying: true, isBuffering: false });

    await vi.waitFor(() =>
      expect(acknowledgeConnectCommandMock).toHaveBeenCalledWith(
        "11111111-1111-1111-1111-111111111111",
        "success",
        undefined,
      ),
    );
  });

  it("fails transfer-in commands that never become ready", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", MockEventSource);
    const opts = handlers();
    renderHook(() =>
      useCrateConnectCommands({
        ...opts,
        isPlaying: false,
        isBuffering: true,
      }),
    );

    const source = MockEventSource.instances[0];
    source?.emit("connect.command", {
      command_id: "11111111-1111-1111-1111-111111111111",
      type: "transfer_in",
      payload: {
        start_playing: true,
        state: {
          device_id: "phone",
          status: "playing",
          title: "Track",
          artist: "Artist",
          album: "Album",
          position_ms: 1000,
          current_index: 0,
          queue: [{ title: "Track", artist: "Artist" }],
          repeat_mode: "off",
          shuffle: false,
        },
      },
    });

    await vi.advanceTimersByTimeAsync(15000);

    await vi.waitFor(() =>
      expect(acknowledgeConnectCommandMock).toHaveBeenCalledWith(
        "11111111-1111-1111-1111-111111111111",
        "error",
        "Transfer target did not become ready",
      ),
    );
  });

  it("acknowledges stale commands without applying them", async () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const opts = handlers();
    renderHook(() => useCrateConnectCommands(opts));

    const source = MockEventSource.instances[0];
    source?.emit("connect.command", {
      command_id: "33333333-3333-3333-3333-333333333333",
      type: "transfer_in",
      created_at: new Date(Date.now() - 120000).toISOString(),
      payload: {
        start_playing: true,
        state: {
          device_id: "phone",
          status: "playing",
          title: "Old Track",
          artist: "Artist",
          album: "Album",
          position_ms: 0,
          current_index: 0,
          queue: [{ title: "Old Track", artist: "Artist" }],
          repeat_mode: "off",
          shuffle: false,
        },
      },
    });

    expect(opts.onTransferIn).not.toHaveBeenCalled();
    await vi.waitFor(() =>
      expect(acknowledgeConnectCommandMock).toHaveBeenCalledWith(
        "33333333-3333-3333-3333-333333333333",
        "ignored",
        "Stale Connect command",
      ),
    );
  });

  it("runs remote transport commands once across replayed events", () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const opts = handlers();
    renderHook(() => useCrateConnectCommands(opts));

    const command = {
      command_id: "22222222-2222-2222-2222-222222222222",
      type: "seek",
      payload: { position_ms: 42000 },
    };
    const source = MockEventSource.instances[0];
    source?.emit("connect.command", command);
    source?.emit("connect.command", command);

    expect(opts.seek).toHaveBeenCalledTimes(1);
    expect(opts.seek).toHaveBeenCalledWith(42);
    expect(acknowledgeConnectCommandMock).toHaveBeenCalledTimes(1);
  });

  it("keeps command dedupe bounded to recent SSE events", () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const opts = handlers();
    renderHook(() => useCrateConnectCommands(opts));

    const source = MockEventSource.instances[0];
    source?.emit("message", {
      command_id: "ignored-message-event",
      type: "pause",
    });
    expect(opts.pause).not.toHaveBeenCalled();

    for (let index = 0; index <= 1000; index += 1) {
      source?.emit("connect.command", {
        command_id: `command-${index}`,
        type: "pause",
      });
    }
    source?.emit("connect.command", {
      command_id: "command-0",
      type: "pause",
    });

    expect(opts.pause).toHaveBeenCalledTimes(1002);
  });

  it("polls pending commands when the event stream is not available", async () => {
    vi.unstubAllGlobals();
    const opts = handlers();
    fetchPendingConnectCommandsMock.mockResolvedValueOnce([
      {
        command_id: "44444444-4444-4444-4444-444444444444",
        type: "seek",
        payload: { position_ms: 18000 },
      },
    ]);

    renderHook(() => useCrateConnectCommands(opts));

    await vi.waitFor(() => expect(opts.seek).toHaveBeenCalledWith(18));
    expect(acknowledgeConnectCommandMock).toHaveBeenCalledWith(
      "44444444-4444-4444-4444-444444444444",
      "success",
      undefined,
    );
  });
});
