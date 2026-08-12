import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useReducer, useRef } from "react";
import { MemoryRouter } from "react-router";

import {
  projectJamClockPosition,
  useJamWebSocket,
} from "@/hooks/use-jam-websocket";
import { initialJamSessionState, jamSessionReducer } from "@/pages/jam-reducer";

class FakeWebSocket {
  static readonly OPEN = 1;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readonly url: string;
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: ((event: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(payload: string) {
    this.sent.push(payload);
  }

  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code: 1000 });
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  message(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

afterEach(() => {
  FakeWebSocket.instances = [];
  vi.unstubAllGlobals();
});

function wrapper({ children }: { children: React.ReactNode }) {
  return <MemoryRouter>{children}</MemoryRouter>;
}

describe("useJamWebSocket", () => {
  it("projects a server clock to the local receive time", () => {
    expect(
      projectJamClockPosition({
        positionMs: 10_000,
        serverTimeMs: 100_000,
        clientNowMs: 100_250,
        clockOffsetMs: 20,
        playing: true,
      }),
    ).toBe(10_270);

    expect(
      projectJamClockPosition({
        positionMs: 10_000,
        serverTimeMs: 100_000,
        clientNowMs: 100_250,
        clockOffsetMs: 20,
        playing: false,
      }),
    ).toBe(10_000);
  });

  it("announces leaving the room before closing an open socket", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);

    const { unmount } = renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play: vi.fn(),
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue: vi.fn(),
          currentTrack: undefined,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 1,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    unmount();

    expect(socket?.sent).toContain(JSON.stringify({ type: "leave" }));
  });

  it("does not crash when roomId is undefined", () => {
    const { result } = renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play: vi.fn(),
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue: vi.fn(),
          currentTrack: undefined,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: undefined,
          userId: undefined,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );
    expect(result.current.sendEvent).toBeDefined();
    expect(result.current.sendEvent({ type: "ping" })).toBe(false);
  });

  it("waits for the authoritative clock before starting a current room track", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const track = { id: "track-1", title: "Track 1", artist: "Artist" };
    const play = vi.fn();
    const seek = vi.fn();

    const { result } = renderHook(
      () => {
        const [state, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play,
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek,
          syncJamQueue: vi.fn(),
          currentTrack: undefined,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return {
          state,
          ...useJamWebSocket({
            roomId: "room-1",
            userId: 1,
            dispatch,
            playerActionsRef,
            currentTimeRef,
            roomNameRef,
          }),
        };
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    expect(socket).toBeDefined();
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "state_sync",
          room: {
            id: "room-1",
            host_user_id: 1,
            name: "Jam",
            status: "active",
            visibility: "private",
            is_permanent: false,
            current_track_payload: {
              track,
              position: 12,
              playing: true,
            },
            created_at: "2026-01-01T00:00:00Z",
            members: [],
            events: [],
          },
        }),
    );

    expect(play).not.toHaveBeenCalled();
    expect(result.current.state.room?.current_track_payload).toEqual(
      expect.objectContaining({ position: 12 }),
    );

    act(
      () =>
        socket?.message({
          type: "queue_add",
          event: {
            id: 1,
            room_id: "room-1",
            user_id: 1,
            event_type: "queue_add",
            payload_json: { track },
            created_at: "2026-01-01T00:00:00Z",
          },
          queue: [
            {
              id: "queue-1",
              track,
              vote_count: 0,
              voted_by_me: false,
            },
          ],
          requests: [],
          members: [],
        }),
    );

    expect(result.current.state.queueItems).toHaveLength(1);
  });

  it("hands an empty room queue to the player so a new room enters Jam mode", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const syncJamQueue = vi.fn();

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play: vi.fn(),
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue,
          currentTrack: undefined,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 1,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "state_sync",
          room: {
            id: "room-1",
            host_user_id: 1,
            name: "Jam",
            status: "active",
            visibility: "private",
            is_permanent: false,
            created_at: "2026-01-01T00:00:00Z",
            members: [],
            events: [],
            queue: [],
          },
        }),
    );

    expect(syncJamQueue).toHaveBeenCalledWith([], {
      currentTrack: null,
      positionSeconds: 0,
      playing: false,
      source: { type: "queue", name: "Jam: Jam" },
    });
  });

  it("does not replace a synced room queue with the stale current local track", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const play = vi.fn();
    const syncJamQueue = vi.fn();
    const track = { id: "room-track", title: "Room track", artist: "Artist" };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play,
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue,
          currentTrack: { id: "local-track", title: "Local", artist: "Artist" },
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 1,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "state_sync",
          room: {
            id: "room-1",
            host_user_id: 1,
            name: "Jam",
            status: "active",
            visibility: "private",
            is_permanent: false,
            created_at: "2026-01-01T00:00:00Z",
            members: [],
            events: [],
            queue: [
              {
                id: "queue-1",
                track,
                vote_count: 0,
                voted_by_me: false,
              },
            ],
            current_track_payload: {
              track,
              position: 4,
              playing: true,
            },
          },
        }),
    );

    expect(syncJamQueue).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it("defers the initial room queue until its sync clock is available", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const play = vi.fn();
    const syncJamQueue = vi.fn();
    const first = { id: "room-track-1", title: "Room 1", artist: "Artist" };
    const second = { id: "room-track-2", title: "Room 2", artist: "Artist" };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play,
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue,
          currentTrack: { id: "local-track", title: "Local", artist: "Artist" },
          isPlaying: false,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 1,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "state_sync",
          room: {
            id: "room-1",
            host_user_id: 1,
            name: "Jam",
            status: "active",
            visibility: "private",
            is_permanent: false,
            created_at: "2026-01-01T00:00:00Z",
            members: [],
            events: [],
            queue: [
              {
                id: "queue-1",
                track: first,
                vote_count: 0,
                voted_by_me: false,
              },
              {
                id: "queue-2",
                track: second,
                vote_count: 0,
                voted_by_me: false,
              },
            ],
            current_track_payload: {
              track: first,
              position: 0,
              playing: true,
            },
          },
        }),
    );

    expect(syncJamQueue).not.toHaveBeenCalled();

    act(
      () =>
        socket?.message({
          type: "sync_clock",
          track: first,
          position_ms: 500,
          playing: true,
        }),
    );

    expect(syncJamQueue).toHaveBeenCalledTimes(1);
    expect(play).not.toHaveBeenCalled();
    expect(syncJamQueue).toHaveBeenLastCalledWith(
      [
        expect.objectContaining({ id: "room-track-1" }),
        expect.objectContaining({ id: "room-track-2" }),
      ],
      expect.objectContaining({
        currentTrack: expect.objectContaining({ id: "room-track-1" }),
        positionSeconds: 0.5,
        playing: true,
      }),
    );
  });

  it("does not pause a Jam player while hydrating a playing room", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const pause = vi.fn();
    const track = { id: "jam-track", title: "Jam track", artist: "Artist" };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play: vi.fn(),
          playAll: vi.fn(),
          pause,
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue: vi.fn(),
          currentTrack: track,
          isPlaying: true,
          playSource: { type: "queue" as const, name: "Jam: Test" },
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Test");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 1,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "state_sync",
          room: {
            id: "room-1",
            host_user_id: 1,
            name: "Test",
            status: "active",
            visibility: "private",
            is_permanent: false,
            created_at: "2026-01-01T00:00:00Z",
            members: [],
            events: [],
            queue: [
              { id: "queue-1", track, vote_count: 0, voted_by_me: false },
            ],
            current_track_payload: { track, position: 0, playing: true },
          },
        }),
    );

    expect(pause).not.toHaveBeenCalled();
  });

  it("also waits for the authoritative clock when a room is paused", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const syncJamQueue = vi.fn();
    const track = { id: "paused-track", title: "Paused", artist: "Artist" };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play: vi.fn(),
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue,
          currentTrack: undefined,
          isPlaying: false,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 1,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "state_sync",
          room: {
            id: "room-1",
            host_user_id: 1,
            name: "Jam",
            status: "active",
            visibility: "private",
            is_permanent: false,
            created_at: "2026-01-01T00:00:00Z",
            members: [],
            events: [],
            queue: [
              { id: "queue-1", track, vote_count: 0, voted_by_me: false },
            ],
            current_track_payload: { track, position: 10, playing: false },
          },
        }),
    );

    expect(syncJamQueue).not.toHaveBeenCalled();

    act(
      () =>
        socket?.message({
          type: "sync_clock",
          track,
          position_ms: 10_030,
          playing: false,
          force_sync: true,
        }),
    );

    expect(syncJamQueue).toHaveBeenCalledWith(
      [expect.objectContaining(track)],
      expect.objectContaining({
        currentTrack: expect.objectContaining(track),
        positionSeconds: 10.03,
        playing: false,
        forcePosition: true,
      }),
    );
  });

  it("applies a remote play event to the authoritative room queue", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const play = vi.fn();
    const syncJamQueue = vi.fn();
    const first = { id: "room-track-1", title: "Room 1", artist: "Artist" };
    const second = { id: "room-track-2", title: "Room 2", artist: "Artist" };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play,
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue,
          currentTrack: undefined,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 2,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "play",
          event: {
            id: 7,
            room_id: "room-1",
            user_id: 1,
            event_type: "play",
            payload_json: {
              track: first,
              position: 3,
              playing: true,
              force_sync: true,
            },
            created_at: "2026-01-01T00:00:00Z",
          },
          queue: [
            { id: "queue-1", track: first, vote_count: 0, voted_by_me: false },
            { id: "queue-2", track: second, vote_count: 0, voted_by_me: false },
          ],
          requests: [],
          members: [],
        }),
    );

    expect(play).not.toHaveBeenCalled();
    expect(syncJamQueue).toHaveBeenCalledWith(
      [
        expect.objectContaining({ id: "room-track-1" }),
        expect.objectContaining({ id: "room-track-2" }),
      ],
      expect.objectContaining({
        currentTrack: expect.objectContaining({ id: "room-track-1" }),
        positionSeconds: 3,
        playing: true,
        forcePosition: true,
      }),
    );
  });

  it("ignores a transport event for a track outside the room queue", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const play = vi.fn();
    const syncJamQueue = vi.fn();
    const roomTrack = { id: "room-track", title: "Room", artist: "Artist" };
    const staleTrack = { id: "stale-track", title: "Stale", artist: "Artist" };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play,
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue,
          currentTrack: undefined,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 2,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "play",
          event: {
            id: 8,
            room_id: "room-1",
            user_id: 1,
            event_type: "play",
            payload_json: { track: staleTrack, position: 2, playing: true },
            created_at: "2026-01-01T00:00:00Z",
          },
          queue: [
            {
              id: "queue-1",
              track: roomTrack,
              vote_count: 0,
              voted_by_me: false,
            },
          ],
          requests: [],
          members: [],
        }),
    );

    expect(play).not.toHaveBeenCalled();
    expect(syncJamQueue).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        currentTrack: expect.objectContaining(staleTrack),
      }),
    );
  });

  it("does not restart or seek active playback for a small clock drift", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const play = vi.fn();
    const resume = vi.fn();
    const seek = vi.fn();
    const setPlaybackRate = vi.fn();
    const track = { id: "track-1", title: "Track 1", artist: "Artist" };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play,
          playAll: vi.fn(),
          pause: vi.fn(),
          resume,
          seek,
          setPlaybackRate,
          syncJamQueue: vi.fn(),
          currentTrack: track,
          isPlaying: true,
        });
        const currentTimeRef = useRef(10);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 2,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "sync_clock",
          track,
          position_ms: 10120,
          playing: true,
        }),
    );

    expect(resume).not.toHaveBeenCalled();
    expect(seek).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
    expect(setPlaybackRate).toHaveBeenCalledWith(1.024);
  });

  it("hard-corrects a small drift when the host explicitly syncs the room", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const seek = vi.fn();
    const setPlaybackRate = vi.fn();
    const track = { id: "track-1", title: "Track 1", artist: "Artist" };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play: vi.fn(),
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek,
          setPlaybackRate,
          syncJamQueue: vi.fn(),
          currentTrack: track,
          isPlaying: true,
        });
        const currentTimeRef = useRef(10);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 2,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "sync_clock",
          track,
          position_ms: 10_030,
          playing: true,
          force_sync: true,
        }),
    );

    expect(seek).toHaveBeenCalledWith(10.03);
    expect(setPlaybackRate).not.toHaveBeenCalledWith(expect.any(Number));
  });

  it("hard-corrects a large phase gap without seeking on every heartbeat", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const seek = vi.fn();
    const setPlaybackRate = vi.fn();
    const track = { id: "track-1", title: "Track 1", artist: "Artist" };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play: vi.fn(),
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek,
          setPlaybackRate,
          syncJamQueue: vi.fn(),
          currentTrack: track,
          isPlaying: true,
        });
        const currentTimeRef = useRef(10);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 2,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(() => {
      socket?.message({
        type: "sync_clock",
        track,
        position_ms: 10400,
        playing: true,
      });
      socket?.message({
        type: "sync_clock",
        track,
        position_ms: 10400,
        playing: true,
      });
    });

    expect(seek).toHaveBeenCalledTimes(1);
    expect(seek).toHaveBeenCalledWith(10.4);
    expect(setPlaybackRate).toHaveBeenCalledWith(1.05);
  });

  it("does not replay the same room track while the first sync is pending", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const play = vi.fn();
    const roomTrack = {
      id: "room-track",
      title: "Room track",
      artist: "Artist",
    };
    const localTrack = {
      id: "local-track",
      title: "Local track",
      artist: "Artist",
    };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play,
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue: vi.fn(),
          currentTrack: localTrack,
          isPlaying: false,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 2,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(() => {
      socket?.message({
        type: "sync_clock",
        track: roomTrack,
        position_ms: 1000,
        playing: true,
      });
      socket?.message({
        type: "sync_clock",
        track: roomTrack,
        position_ms: 1000,
        playing: true,
      });
    });

    expect(play).toHaveBeenCalledTimes(1);
  });

  it("applies an empty authoritative queue after the host removes an item", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const track = {
      id: "track-1",
      title: "Track 1",
      artist: "Artist",
      path: "/music/Artist/Track 1.flac",
    };
    const syncJamQueue = vi.fn();

    const { result } = renderHook(
      () => {
        const [state, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play: vi.fn(),
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue,
          currentTrack: undefined,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return {
          state,
          ...useJamWebSocket({
            roomId: "room-1",
            userId: 1,
            dispatch,
            playerActionsRef,
            currentTimeRef,
            roomNameRef,
          }),
        };
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "state_sync",
          room: {
            id: "room-1",
            host_user_id: 1,
            name: "Jam",
            status: "active",
            visibility: "private",
            is_permanent: false,
            created_at: "2026-01-01T00:00:00Z",
            members: [],
            events: [],
            queue: [
              {
                id: "queue-1",
                track,
                vote_count: 0,
                voted_by_me: false,
              },
            ],
          },
        }),
    );

    act(
      () =>
        socket?.message({
          type: "queue_remove",
          event: {
            id: 4,
            room_id: "room-1",
            user_id: 1,
            event_type: "queue_remove",
            payload_json: { queue_item_id: "queue-1" },
            created_at: "2026-01-01T00:00:01Z",
          },
          queue: [],
          requests: [],
          members: [],
        }),
    );

    expect(result.current.state.queueItems).toEqual([]);
    expect(result.current.state.sharedQueue).toEqual([]);
    expect(syncJamQueue).toHaveBeenNthCalledWith(
      1,
      [expect.objectContaining({ path: "/music/Artist/Track 1.flac" })],
      {
        currentTrack: null,
        playing: false,
        positionSeconds: 0,
        source: { type: "queue", name: "Jam: Jam" },
      },
    );
    expect(syncJamQueue).toHaveBeenLastCalledWith([], {
      queueOnly: true,
      source: { type: "queue", name: "Jam: Jam" },
    });
  });

  it("applies the member's own vote when the websocket serializes user ids", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const track = { id: "track-1", title: "Track 1", artist: "Artist" };

    const { result } = renderHook(
      () => {
        const [state, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play: vi.fn(),
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue: vi.fn(),
          currentTrack: undefined,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return {
          state,
          ...useJamWebSocket({
            roomId: "room-1",
            userId: 1,
            dispatch,
            playerActionsRef,
            currentTimeRef,
            roomNameRef,
          }),
        };
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "queue_vote",
          event: {
            id: 7,
            room_id: "room-1",
            user_id: "1",
            event_type: "queue_vote",
            payload_json: {
              queue_item_id: "queue-1",
              voted: true,
              vote_count: 1,
            },
            created_at: "2026-01-01T00:00:00Z",
          },
          queue: [
            {
              id: "queue-1",
              track,
              vote_count: 1,
              voted_by_me: false,
            },
          ],
          requests: [],
          members: [],
        }),
    );

    expect(result.current.state.queueItems[0]).toEqual(
      expect.objectContaining({
        id: "queue-1",
        vote_count: 1,
        voted_by_me: true,
      }),
    );
  });

  it("starts the owner playback when play_next carries a numeric track id", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const play = vi.fn();
    const pause = vi.fn();
    const syncJamQueue = vi.fn();
    const track = { id: 42, title: "Track 42", artist: "Artist" };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play,
          playAll: vi.fn(),
          pause,
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue,
          currentTrack: undefined,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 1,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "play_next",
          event: {
            id: 2,
            room_id: "room-1",
            user_id: 1,
            event_type: "play_next",
            payload_json: {
              track,
              position: 0,
              playing: true,
            },
            created_at: "2026-01-01T00:00:00Z",
          },
          queue: [],
          requests: [],
          members: [],
        }),
    );

    expect(syncJamQueue).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "42" })],
      expect.objectContaining({
        currentTrack: expect.objectContaining({ id: "42" }),
        positionSeconds: 0,
        playing: true,
      }),
    );
    expect(play).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it("loads the authoritative room queue when queue_play is broadcast", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const play = vi.fn();
    const playAll = vi.fn();
    const syncJamQueue = vi.fn();
    const first = { id: "track-1", title: "Track 1", artist: "Artist" };
    const second = { id: "track-2", title: "Track 2", artist: "Artist" };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play,
          playAll,
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue,
          currentTrack: undefined,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 2,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "queue_play",
          event: {
            id: 3,
            room_id: "room-1",
            user_id: 1,
            event_type: "queue_play",
            payload_json: { track: first, position: 0, playing: true },
            created_at: "2026-01-01T00:00:00Z",
          },
          queue: [
            { id: "queue-1", track: first, vote_count: 0, voted_by_me: false },
            { id: "queue-2", track: second, vote_count: 0, voted_by_me: false },
          ],
          requests: [],
          members: [],
        }),
    );

    expect(syncJamQueue).toHaveBeenCalledWith(
      [expect.objectContaining(first), expect.objectContaining(second)],
      expect.objectContaining({
        currentTrack: expect.objectContaining(first),
        positionSeconds: 0,
        playing: true,
      }),
    );
    expect(playAll).not.toHaveBeenCalled();
    expect(play).not.toHaveBeenCalled();
  });

  it("starts the first room track when queue_play has no track payload", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const playAll = vi.fn();
    const pause = vi.fn();
    const syncJamQueue = vi.fn();
    const first = { id: "track-1", title: "Track 1", artist: "Artist" };
    const second = { id: "track-2", title: "Track 2", artist: "Artist" };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play: vi.fn(),
          playAll,
          pause,
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue,
          currentTrack: undefined,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 2,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "queue_play",
          event: {
            id: 4,
            room_id: "room-1",
            user_id: 1,
            event_type: "queue_play",
            payload_json: { position: 0, playing: true },
            created_at: "2026-01-01T00:00:00Z",
          },
          queue: [
            { id: "queue-1", track: first, vote_count: 0, voted_by_me: false },
            { id: "queue-2", track: second, vote_count: 0, voted_by_me: false },
          ],
          requests: [],
          members: [],
        }),
    );

    expect(syncJamQueue).toHaveBeenCalledWith(
      [expect.objectContaining(first), expect.objectContaining(second)],
      expect.objectContaining({
        currentTrack: expect.objectContaining(first),
        positionSeconds: 0,
        playing: true,
      }),
    );
    expect(playAll).not.toHaveBeenCalled();
    expect(pause).not.toHaveBeenCalled();
  });

  it("starts the local player when queue_add starts an idle room", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const syncJamQueue = vi.fn();
    const first = { id: "track-1", title: "Track 1", artist: "Artist" };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play: vi.fn(),
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue,
          currentTrack: undefined,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 1,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "queue_add",
          event: {
            id: 5,
            room_id: "room-1",
            user_id: 1,
            event_type: "queue_add",
            payload_json: {
              track: first,
              current_track: first,
              position: 0,
              playing: true,
            },
            created_at: "2026-01-01T00:00:00Z",
          },
          queue: [
            { id: "queue-1", track: first, vote_count: 0, voted_by_me: false },
          ],
          requests: [],
          members: [],
        }),
    );

    expect(syncJamQueue).toHaveBeenCalledWith(
      [expect.objectContaining(first)],
      expect.objectContaining({
        currentTrack: expect.objectContaining(first),
        playing: true,
      }),
    );
  });

  it("marks ordinary room queue snapshots as queue-only updates", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const syncJamQueue = vi.fn();
    const first = { id: "track-1", title: "Track 1", artist: "Artist" };
    const second = { id: "track-2", title: "Track 2", artist: "Artist" };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play: vi.fn(),
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue,
          currentTrack: first,
          isPlaying: true,
        });
        const currentTimeRef = useRef(42);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 2,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "queue_reorder",
          event: {
            id: 8,
            room_id: "room-1",
            user_id: 1,
            event_type: "queue_reorder",
            payload_json: { queue_item_id: "queue-2", toIndex: 0 },
            created_at: "2026-01-01T00:00:00Z",
          },
          queue: [
            { id: "queue-2", track: second, vote_count: 0, voted_by_me: false },
            { id: "queue-1", track: first, vote_count: 0, voted_by_me: false },
          ],
          requests: [],
          members: [],
        }),
    );

    expect(syncJamQueue).toHaveBeenCalledWith(
      [expect.objectContaining(second), expect.objectContaining(first)],
      expect.objectContaining({
        queueOnly: true,
        source: { type: "queue", name: "Jam: Jam" },
      }),
    );
  });

  it("ignores a stale room event after a newer queue revision was applied", () => {
    vi.stubGlobal("WebSocket", FakeWebSocket);
    const syncJamQueue = vi.fn();
    const first = { id: "track-1", title: "Track 1", artist: "Artist" };
    const second = { id: "track-2", title: "Track 2", artist: "Artist" };

    renderHook(
      () => {
        const [, dispatch] = useReducer(
          jamSessionReducer,
          initialJamSessionState,
        );
        const playerActionsRef = useRef({
          play: vi.fn(),
          playAll: vi.fn(),
          pause: vi.fn(),
          resume: vi.fn(),
          seek: vi.fn(),
          syncJamQueue,
          currentTrack: undefined,
        });
        const currentTimeRef = useRef(0);
        const roomNameRef = useRef("Jam");
        return useJamWebSocket({
          roomId: "room-1",
          userId: 2,
          dispatch,
          playerActionsRef,
          currentTimeRef,
          roomNameRef,
        });
      },
      { wrapper },
    );

    const socket = FakeWebSocket.instances[0];
    act(() => socket?.open());
    act(
      () =>
        socket?.message({
          type: "queue_add",
          event: {
            id: 12,
            room_id: "room-1",
            user_id: 1,
            event_type: "queue_add",
            payload_json: { track: first },
            created_at: "2026-01-01T00:00:12Z",
          },
          queue: [{ id: "queue-1", track: first, vote_count: 0 }],
          requests: [],
          members: [],
        }),
    );
    act(
      () =>
        socket?.message({
          type: "queue_reorder",
          event: {
            id: 11,
            room_id: "room-1",
            user_id: 1,
            event_type: "queue_reorder",
            payload_json: { fromIndex: 0, toIndex: 1 },
            created_at: "2026-01-01T00:00:11Z",
          },
          queue: [{ id: "queue-2", track: second, vote_count: 0 }],
          requests: [],
          members: [],
        }),
    );

    expect(syncJamQueue).toHaveBeenCalledTimes(1);
  });
});
