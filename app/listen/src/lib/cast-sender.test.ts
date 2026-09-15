import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  apiMock,
  ensureMediaAccessUrlMock,
  runtimeMock,
  nativeCapabilitiesMock,
  nativeControlMock,
  nativeEndSessionMock,
  nativeGetQueueSnapshotMock,
  nativeRequestSessionMock,
  nativeQueueInsertMock,
  nativeQueueJumpToMock,
  nativeQueueNextMock,
  nativeQueuePreviousMock,
  nativeQueueRemoveMock,
  nativeQueueReorderMock,
  nativeQueueSetRepeatModeMock,
  nativeListenerMock,
  nativePlaybackStateListeners,
  nativeProtocolMessageListeners,
  sessionChangedListeners,
} = vi.hoisted(() => ({
  apiMock: vi.fn(),
  ensureMediaAccessUrlMock: vi.fn(),
  runtimeMock: { isNative: false },
  nativeCapabilitiesMock: vi.fn(),
  nativeControlMock: vi.fn(),
  nativeEndSessionMock: vi.fn(),
  nativeGetQueueSnapshotMock: vi.fn(),
  nativeRequestSessionMock: vi.fn(),
  nativeQueueInsertMock: vi.fn(),
  nativeQueueJumpToMock: vi.fn(),
  nativeQueueNextMock: vi.fn(),
  nativeQueuePreviousMock: vi.fn(),
  nativeQueueRemoveMock: vi.fn(),
  nativeQueueReorderMock: vi.fn(),
  nativeQueueSetRepeatModeMock: vi.fn(),
  nativeListenerMock: vi.fn(),
  nativePlaybackStateListeners: [] as Array<(event: unknown) => void>,
  nativeProtocolMessageListeners: [] as Array<(event: unknown) => void>,
  sessionChangedListeners: [] as Array<(event: unknown) => void>,
}));

vi.mock("@capacitor/core", () => ({
  registerPlugin: () => ({
    getCapabilities: nativeCapabilitiesMock,
    play: nativeControlMock,
    pause: nativeControlMock,
    stop: nativeControlMock,
    endSession: nativeEndSessionMock,
    getQueueSnapshot: nativeGetQueueSnapshotMock,
    queueInsert: nativeQueueInsertMock,
    queueJumpTo: nativeQueueJumpToMock,
    queueNext: nativeQueueNextMock,
    queuePrevious: nativeQueuePreviousMock,
    queueRemove: nativeQueueRemoveMock,
    queueReorder: nativeQueueReorderMock,
    queueSetRepeatMode: nativeQueueSetRepeatModeMock,
    requestSession: nativeRequestSessionMock,
    addListener: nativeListenerMock.mockImplementation(
      (event: string, listener: (event: unknown) => void) => {
        if (event === "sessionChanged") sessionChangedListeners.push(listener);
        if (event === "playbackState") {
          nativePlaybackStateListeners.push(listener);
        }
        if (event === "protocolMessage") {
          nativeProtocolMessageListeners.push(listener);
        }
        return Promise.resolve({ remove: vi.fn() });
      },
    ),
  }),
}));

vi.mock("@/lib/api", () => ({
  api: apiMock,
  apiUrl: (path: string) => `https://crate.test${path}`,
  ensureMediaAccessUrl: ensureMediaAccessUrlMock,
}));

vi.mock("@/lib/capacitor-runtime", () => ({
  get isNative() {
    return runtimeMock.isNative;
  },
}));

import {
  buildCastTicketRequest,
  castPause,
  castPlay,
  castQueueJumpTo,
  castQueueNext,
  castQueuePrevious,
  castSeek,
  castSetVolume,
  castStop,
  disconnectCastSession,
  endCastSession,
  getCastSenderCapabilities,
  isCastSessionActive,
  isCustomCastSessionActive,
  onCastSessionChanged,
  startCastSession,
  stopCastSession,
  subscribeCastPlaybackState,
  syncCustomCastQueue,
} from "@/lib/cast-sender";

describe("cast sender", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runtimeMock.isNative = false;
    vi.unstubAllEnvs();
    ensureMediaAccessUrlMock.mockImplementation(
      async (url: string) =>
        `${url}${url.includes("?") ? "&" : "?"}media_ticket=artwork-ticket`,
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds auto delivery cast tickets from stable track references", () => {
    expect(
      buildCastTicketRequest(
        {
          id: "track-1",
          libraryTrackId: 7,
          entityUid: "11111111-1111-1111-1111-111111111111",
          path: "Artist/Album/track.flac",
          title: "Track",
          artist: "Artist",
        },
        "living-room",
      ),
    ).toMatchObject({
      track_id: 7,
      purpose: "google_cast",
      target_device_id: "living-room",
      delivery: "auto",
      receiver_capabilities: {
        formats: ["mp3", "aac", "m4a"],
      },
    });

    expect(
      buildCastTicketRequest({
        id: "path-only",
        path: "Artist/Album/path-only.flac",
        title: "Path Only",
        artist: "Artist",
      }),
    ).toMatchObject({
      track_path: "Artist/Album/path-only.flac",
      delivery: "auto",
    });
  });

  it("hides web Cast where the browser cannot host a sender", async () => {
    const chromeWindow = window as Window & { chrome?: unknown };
    const previousChrome = chromeWindow.chrome;
    delete chromeWindow.chrome;

    const capabilities = await getCastSenderCapabilities();

    expect(capabilities).toMatchObject({
      platform: "unsupported",
      visible: false,
      available: false,
      activeSession: false,
    });
    chromeWindow.chrome = previousChrome;
  });

  it("hides native Cast when the platform build has no sender SDK", async () => {
    runtimeMock.isNative = true;
    nativeCapabilitiesMock.mockResolvedValueOnce({
      platform: "native",
      visible: false,
      available: false,
      activeSession: false,
      reason: "Google Cast SDK is not linked in this iOS build.",
    });

    const capabilities = await getCastSenderCapabilities();

    expect(capabilities).toMatchObject({
      platform: "native",
      visible: false,
      available: false,
      activeSession: false,
    });
  });

  it("loads the full receiver-owned queue through the native bridge", async () => {
    runtimeMock.isNative = true;
    vi.stubEnv("VITE_CAST_CUSTOM_RECEIVER_ENABLED", "true");
    vi.stubEnv("VITE_CAST_RECEIVER_APP_ID", "ABCD1234");
    nativeCapabilitiesMock.mockResolvedValue({
      platform: "native",
      visible: true,
      available: true,
      activeSession: false,
      receiverApplicationId: "ABCD1234",
    });
    nativeRequestSessionMock.mockResolvedValue({ ok: true });
    apiMock.mockResolvedValue({
      session_id: "native-session",
      lease: "receiver-lease",
      bootstrap_url: "https://api.example/cast/receiver-lease",
      receiver_application_id: "ABCD1234",
      queue: {
        revision: 0,
        state_seq: 0,
        current_index: 1,
        current_time: 24,
        repeat_mode: "all",
        shuffle: false,
        items: [
          {
            item_id: "item-1",
            title: "One",
            artist: "Artist",
            content_type: "audio/mpeg",
            stream_url: "https://api.example/one",
            metadata_url: "https://api.example/one/meta",
          },
          {
            item_id: "item-2",
            title: "Two",
            artist: "Artist",
            content_type: "audio/mpeg",
            stream_url: "https://api.example/two",
            metadata_url: "https://api.example/two/meta",
          },
        ],
      },
    });

    const result = await startCastSession({
      track: {
        id: "two",
        libraryTrackId: 2,
        title: "Two",
        artist: "Artist",
      },
      queue: [
        {
          id: "one",
          libraryTrackId: 1,
          title: "One",
          artist: "Artist",
        },
        {
          id: "two",
          libraryTrackId: 2,
          title: "Two",
          artist: "Artist",
        },
      ],
      currentIndex: 1,
      currentTime: 24,
      repeatMode: "all",
    });

    expect(result).toEqual({ ok: true });
    expect(apiMock).toHaveBeenCalledWith(
      "/api/me/cast/sessions",
      "POST",
      expect.objectContaining({ current_index: 1, repeat_mode: "all" }),
    );
    expect(nativeRequestSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        protocolVersion: 1,
        sessionId: "native-session",
        currentIndex: 1,
        currentTime: 24,
        items: [
          expect.objectContaining({ stableId: "item-1" }),
          expect.objectContaining({ stableId: "item-2" }),
        ],
      }),
    );
  });

  it("uses the native receiver id as the custom receiver source of truth", async () => {
    runtimeMock.isNative = true;
    nativeCapabilitiesMock.mockResolvedValue({
      platform: "native",
      visible: true,
      available: true,
      activeSession: false,
      receiverApplicationId: "ABCD1234",
    });
    nativeRequestSessionMock.mockResolvedValue({ ok: true });
    apiMock.mockResolvedValue({
      session_id: "native-configured",
      lease: "lease",
      bootstrap_url: "https://api.example/cast/native-configured",
      receiver_application_id: "ABCD1234",
      queue: {
        revision: 0,
        state_seq: 0,
        current_index: 0,
        current_time: 0,
        repeat_mode: "off",
        shuffle: false,
        items: [
          {
            item_id: "track-1-1",
            track_id: 1,
            title: "Track",
            artist: "Artist",
            content_type: "audio/mpeg",
            stream_url: "https://api.example/track",
            metadata_url: "https://api.example/track/meta",
          },
        ],
      },
    });

    await expect(
      startCastSession({
        track: {
          id: "track-1",
          libraryTrackId: 1,
          title: "Track",
          artist: "Artist",
        },
      }),
    ).resolves.toMatchObject({ ok: true });

    expect(nativeRequestSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        protocolVersion: 1,
        sessionId: "native-configured",
      }),
    );
  });

  it("rehydrates scoped native Cast metadata from capabilities", async () => {
    runtimeMock.isNative = true;
    nativeCapabilitiesMock.mockResolvedValue({
      platform: "native",
      visible: true,
      available: true,
      activeSession: true,
      receiverApplicationId: "ABCD1234",
      sessionId: "native-resumed",
      bootstrapUrl: "https://api.example/cast/native-resumed",
    });

    await getCastSenderCapabilities();

    expect(isCustomCastSessionActive()).toBe(true);
  });

  it("clears stale Crate metadata when native resumes a default receiver", async () => {
    runtimeMock.isNative = true;
    nativeCapabilitiesMock.mockResolvedValue({
      platform: "native",
      visible: true,
      available: true,
      activeSession: true,
      receiverApplicationId: "ABCD1234",
      sessionId: "native-custom",
      bootstrapUrl: "https://api.example/cast/native-custom",
    });
    await getCastSenderCapabilities();
    expect(isCustomCastSessionActive()).toBe(true);

    sessionChangedListeners.forEach((listener) =>
      listener({ active: true, targetName: "Default receiver" }),
    );

    expect(isCustomCastSessionActive()).toBe(false);
  });

  it("reports web Cast unavailable when the SDK finds no receivers", async () => {
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => null),
      getCastState: vi.fn(() => "NO_DEVICES_AVAILABLE"),
      requestSession: vi.fn(),
      endCurrentSession: vi.fn(),
    };
    Object.assign(window, {
      cast: {
        framework: {
          CastContext: { getInstance: () => context },
          CastState: { NO_DEVICES_AVAILABLE: "NO_DEVICES_AVAILABLE" },
        },
      },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          media: { DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845" },
        },
      },
    });

    await expect(getCastSenderCapabilities()).resolves.toMatchObject({
      platform: "web",
      visible: true,
      available: false,
      activeSession: false,
      reason: "No Cast receivers found on this network.",
    });
  });

  it("forwards web Cast lifecycle changes to Listen", async () => {
    const sdkListeners = new Map<string, () => void>();
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => null),
      getCastState: vi.fn(() => "NOT_CONNECTED"),
      requestSession: vi.fn(),
      endCurrentSession: vi.fn(),
      addEventListener: vi.fn((event: string, listener: () => void) => {
        sdkListeners.set(event, listener);
      }),
    };
    Object.assign(window, {
      cast: {
        framework: {
          CastContext: { getInstance: () => context },
          CastContextEventType: {
            CAST_STATE_CHANGED: "CAST_STATE_CHANGED",
            SESSION_STATE_CHANGED: "SESSION_STATE_CHANGED",
          },
        },
      },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          media: { DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845" },
        },
      },
    });
    const listener = vi.fn();
    const cleanup = onCastSessionChanged(listener);

    await getCastSenderCapabilities();
    sdkListeners.get("SESSION_STATE_CHANGED")?.();

    expect(listener).toHaveBeenCalledTimes(1);
    cleanup();
  });

  it("does not request tickets when the track has no cast reference", async () => {
    const result = await startCastSession({
      track: {
        id: "ephemeral",
        title: "Ephemeral",
        artist: "Artist",
      },
    });

    expect(result).toEqual({
      ok: false,
      message: "This track does not expose a Cast-capable library reference.",
    });
    expect(apiMock).not.toHaveBeenCalled();
  });

  it("opens the web Cast picker before preparing receiver media", async () => {
    const calls: string[] = [];
    const session = {
      loadMedia: vi.fn(async () => undefined),
      getCastDevice: () => ({ friendlyName: "Living Room" }),
    };
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => null),
      requestSession: vi.fn(async () => {
        calls.push("picker");
        return session;
      }),
    };
    Object.assign(window, {
      cast: {
        framework: {
          CastContext: {
            getInstance: () => context,
          },
        },
      },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          Image: class {},
          media: {
            DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845",
            LoadRequest: class {},
            MediaInfo: class {},
            MusicTrackMediaMetadata: class {},
          },
        },
      },
    });
    apiMock.mockImplementation(async () => {
      calls.push("ticket");
      return {
        stream_url: "https://stream.example/track",
        metadata_url: "https://stream.example/metadata",
        expires_at: "2030-01-01T00:00:00Z",
        delivery_policy: "direct",
      };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      calls.push("metadata");
      return new Response(
        JSON.stringify({
          stream_url: "https://stream.example/track",
          title: "Track",
          artist: "Artist",
        }),
        { status: 200 },
      );
    });

    await expect(
      startCastSession({
        track: {
          id: "track-1",
          libraryTrackId: 1,
          title: "Track",
          artist: "Artist",
        },
      }),
    ).resolves.toMatchObject({ ok: true, targetName: "Living Room" });

    expect(calls).toEqual(["picker", "ticket", "metadata"]);
    expect(session.loadMedia).toHaveBeenCalledOnce();
  });

  it("loads the full queue into the configured custom receiver", async () => {
    vi.stubEnv("VITE_CAST_CUSTOM_RECEIVER_ENABLED", "true");
    vi.stubEnv("VITE_CAST_RECEIVER_APP_ID", "ABCD1234");
    const queueLoad = vi.fn(
      (
        _items: unknown[],
        _repeat: string,
        _index: number,
        _time: number,
        _customData: unknown,
        success: () => void,
      ) => success(),
    );
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => null),
      requestSession: vi.fn(async () => ({
        getCastDevice: () => ({ friendlyName: "Living Room" }),
        getSessionObj: () => ({ queueLoad }),
      })),
      endCurrentSession: vi.fn(),
    };
    class MediaInfo {
      customData?: unknown;
      metadata?: unknown;
      duration?: number;
      constructor(
        public contentId: string,
        public contentType: string,
      ) {}
    }
    class QueueItem {
      autoplay?: boolean;
      startTime?: number;
      constructor(public media: MediaInfo) {}
    }
    Object.assign(window, {
      cast: { framework: { CastContext: { getInstance: () => context } } },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          Image: class {
            constructor(public url: string) {}
          },
          media: {
            DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845",
            MediaInfo,
            MusicTrackMediaMetadata: class {},
            QueueItem,
            RepeatMode: { OFF: "OFF", ALL: "ALL", SINGLE: "SINGLE" },
          },
        },
      },
    });
    apiMock.mockResolvedValue({
      session_id: "session-1",
      lease: "private-lease",
      bootstrap_url: "https://api.example/api/cast/sessions/private-lease",
      receiver_application_id: "ABCD1234",
      queue: {
        revision: 0,
        state_seq: 0,
        current_index: 1,
        current_time: 17,
        repeat_mode: "all",
        shuffle: false,
        items: [
          {
            item_id: "one",
            title: "One",
            artist: "Artist",
            content_type: "audio/mpeg",
            stream_url: "https://api.example/one",
            metadata_url: "https://api.example/one/meta",
          },
          {
            item_id: "two",
            title: "Two",
            artist: "Artist",
            content_type: "audio/mpeg",
            stream_url: "https://api.example/two",
            metadata_url: "https://api.example/two/meta",
          },
        ],
      },
    });

    await expect(
      startCastSession({
        track: {
          id: "two",
          libraryTrackId: 2,
          title: "Two",
          artist: "Artist",
        },
        queue: [
          { id: "one", libraryTrackId: 1, title: "One", artist: "Artist" },
          { id: "two", libraryTrackId: 2, title: "Two", artist: "Artist" },
        ],
        currentIndex: 1,
        currentTime: 17,
        repeatMode: "all",
      }),
    ).resolves.toMatchObject({ ok: true, targetName: "Living Room" });

    expect(context.setOptions).toHaveBeenCalledWith(
      expect.objectContaining({ receiverApplicationId: "ABCD1234" }),
    );
    expect(apiMock).toHaveBeenCalledWith(
      "/api/me/cast/sessions",
      "POST",
      expect.objectContaining({ current_index: 1, items: expect.any(Array) }),
    );
    expect(queueLoad).toHaveBeenCalledWith(
      expect.any(Array),
      "ALL",
      1,
      17,
      { crateCast: { protocolVersion: 1, sessionId: "session-1" } },
      expect.any(Function),
      expect.any(Function),
    );
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("edits a custom receiver queue without reloading active media", async () => {
    vi.stubEnv("VITE_CAST_CUSTOM_RECEIVER_ENABLED", "true");
    vi.stubEnv("VITE_CAST_RECEIVER_APP_ID", "ABCD1234");
    const queueLoad = vi.fn(
      (
        _items: unknown[],
        _repeat: string,
        _index: number,
        _time: number,
        _customData: unknown,
        success: () => void,
      ) => success(),
    );
    const queueInsertItems = vi.fn((_request: unknown, success: () => void) =>
      success(),
    );
    const media = {
      items: [
        {
          itemId: 41,
          media: {
            customData: { crateCast: { itemId: "track-1-1" } },
          },
        },
      ],
      media: {
        customData: {
          crateCast: {
            protocolVersion: 1,
            sessionId: "session-edit",
            bootstrapUrl: "https://api.example/api/cast/sessions/lease",
          },
        },
      },
      queueInsertItems,
      queueRemoveItems: vi.fn(),
      queueReorderItems: vi.fn(),
      queueSetRepeatMode: vi.fn(),
    };
    const session = {
      getMediaSession: () => media,
      getSessionObj: () => ({ queueLoad }),
    };
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => session),
      requestSession: vi.fn(async () => session),
      endCurrentSession: vi.fn(),
    };
    class MediaInfo {
      customData?: unknown;
      metadata?: unknown;
      constructor(
        public contentId: string,
        public contentType: string,
      ) {}
    }
    class QueueItem {
      autoplay?: boolean;
      constructor(public media: MediaInfo) {}
    }
    class QueueInsertItemsRequest {
      insertBefore?: number;
      constructor(public items: QueueItem[]) {}
    }
    Object.assign(window, {
      cast: { framework: { CastContext: { getInstance: () => context } } },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          Image: class {},
          media: {
            DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845",
            MediaInfo,
            MusicTrackMediaMetadata: class {},
            QueueItem,
            QueueInsertItemsRequest,
            QueueRemoveItemsRequest: class {},
            QueueReorderItemsRequest: class {},
            RepeatMode: { OFF: "OFF", ALL: "ALL", SINGLE: "SINGLE" },
          },
        },
      },
    });
    const initial = {
      session_id: "session-edit",
      lease: "lease",
      bootstrap_url: "https://api.example/api/cast/sessions/lease",
      receiver_application_id: "ABCD1234",
      queue: {
        revision: 0,
        state_seq: 0,
        current_index: 0,
        current_time: 0,
        repeat_mode: "off" as const,
        shuffle: false,
        items: [
          {
            item_id: "track-1-1",
            track_id: 1,
            title: "One",
            artist: "Artist",
            content_type: "audio/mpeg",
            stream_url: "https://api.example/one",
            metadata_url: "https://api.example/one/meta",
          },
        ],
      },
    };
    const scoped = {
      ...initial,
      protocol_version: 1,
      queue: {
        ...initial.queue,
        revision: 1,
        items: [
          initial.queue.items[0],
          {
            item_id: "track-2-1",
            track_id: 2,
            title: "Two",
            artist: "Artist",
            content_type: "audio/mpeg",
            stream_url: "https://api.example/two",
            metadata_url: "https://api.example/two/meta",
          },
        ],
      },
    };
    apiMock.mockResolvedValueOnce(initial).mockResolvedValueOnce({
      mutation_status: "applied",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(scoped), { status: 200 }),
    );
    const one = {
      id: "one",
      libraryTrackId: 1,
      title: "One",
      artist: "Artist",
    };
    const two = {
      id: "two",
      libraryTrackId: 2,
      title: "Two",
      artist: "Artist",
    };

    await startCastSession({ track: one, queue: [one] });
    await expect(
      syncCustomCastQueue({
        queue: [one, two],
        currentIndex: 0,
        repeatMode: "off",
        shuffle: false,
      }),
    ).resolves.toEqual({ ok: true });

    expect(queueLoad).toHaveBeenCalledOnce();
    expect(queueInsertItems).toHaveBeenCalledOnce();
    expect(apiMock).toHaveBeenLastCalledWith(
      "/api/me/cast/sessions/session-edit",
      "PATCH",
      expect.objectContaining({
        expected_revision: 0,
        items: [
          { item_id: "track-1-1", track_id: 1 },
          { item_id: "track-2-1", track_id: 2 },
        ],
      }),
    );
  });

  it("applies receiver-owned queue edits through the native bridge", async () => {
    runtimeMock.isNative = true;
    vi.stubEnv("VITE_CAST_CUSTOM_RECEIVER_ENABLED", "true");
    vi.stubEnv("VITE_CAST_RECEIVER_APP_ID", "ABCD1234");
    nativeCapabilitiesMock.mockResolvedValue({
      platform: "native",
      visible: true,
      available: true,
      activeSession: false,
      receiverApplicationId: "ABCD1234",
    });
    nativeRequestSessionMock.mockResolvedValue({ ok: true });
    nativeGetQueueSnapshotMock.mockResolvedValueOnce({
      available: true,
      items: [
        { stableId: "track-1-1", itemId: 41 },
        { stableId: "track-2-1", itemId: 42 },
        { stableId: "track-3-1", itemId: 43 },
      ],
    });
    for (const mock of [
      nativeQueueInsertMock,
      nativeQueueRemoveMock,
      nativeQueueReorderMock,
      nativeQueueSetRepeatModeMock,
    ]) {
      mock.mockResolvedValue({ ok: true });
    }
    const initial = {
      session_id: "native-edit",
      lease: "lease",
      bootstrap_url: "https://api.example/api/cast/sessions/native-lease",
      receiver_application_id: "ABCD1234",
      queue: {
        revision: 0,
        state_seq: 0,
        current_index: 0,
        current_time: 0,
        repeat_mode: "off" as const,
        shuffle: false,
        items: [1, 2, 3].map((id) => ({
          item_id: `track-${id}-1`,
          track_id: id,
          title: `Track ${id}`,
          artist: "Artist",
          content_type: "audio/mpeg",
          stream_url: `https://api.example/${id}`,
          metadata_url: `https://api.example/${id}/meta`,
        })),
      },
    };
    const scoped = {
      ...initial,
      protocol_version: 1,
      queue: {
        ...initial.queue,
        revision: 1,
        repeat_mode: "all" as const,
        items: [
          initial.queue.items[2],
          {
            item_id: "track-4-1",
            track_id: 4,
            title: "Track 4",
            artist: "Artist",
            content_type: "audio/mpeg",
            stream_url: "https://api.example/4",
            metadata_url: "https://api.example/4/meta",
          },
          initial.queue.items[1],
        ],
      },
    };
    apiMock.mockResolvedValueOnce(initial).mockResolvedValueOnce({
      mutation_status: "applied",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(scoped), { status: 200 }),
    );
    const track = (id: number) => ({
      id: `track-${id}`,
      libraryTrackId: id,
      title: `Track ${id}`,
      artist: "Artist",
    });

    await startCastSession({ track: track(1), queue: [1, 2, 3].map(track) });
    await expect(
      syncCustomCastQueue({
        queue: [3, 4, 2].map(track),
        currentIndex: 0,
        repeatMode: "all",
        shuffle: false,
      }),
    ).resolves.toEqual({ ok: true });

    expect(nativeQueueRemoveMock).toHaveBeenCalledWith({ itemIds: [41] });
    expect(nativeQueueInsertMock).toHaveBeenCalledWith({
      items: [expect.objectContaining({ stableId: "track-4-1" })],
      insertBefore: 42,
    });
    expect(nativeQueueReorderMock).toHaveBeenCalledWith({
      itemIds: [43, 42],
    });
    expect(nativeQueueSetRepeatModeMock).toHaveBeenCalledWith({
      repeatMode: "all",
    });
  });

  it("does not duplicate a native queue while its snapshot is unavailable", async () => {
    runtimeMock.isNative = true;
    vi.stubEnv("VITE_CAST_CUSTOM_RECEIVER_ENABLED", "true");
    vi.stubEnv("VITE_CAST_RECEIVER_APP_ID", "ABCD1234");
    nativeCapabilitiesMock.mockResolvedValue({
      platform: "native",
      visible: true,
      available: true,
      activeSession: false,
      receiverApplicationId: "ABCD1234",
    });
    nativeRequestSessionMock.mockResolvedValue({ ok: true });
    nativeGetQueueSnapshotMock.mockResolvedValue({
      available: false,
      items: [],
    });
    const initial = {
      session_id: "native-pending-snapshot",
      lease: "lease",
      bootstrap_url: "https://api.example/cast/native-pending-snapshot",
      receiver_application_id: "ABCD1234",
      queue: {
        revision: 0,
        state_seq: 0,
        current_index: 0,
        current_time: 0,
        repeat_mode: "off" as const,
        shuffle: false,
        items: [
          {
            item_id: "track-1-1",
            track_id: 1,
            title: "Track 1",
            artist: "Artist",
            content_type: "audio/mpeg",
            stream_url: "https://api.example/1",
            metadata_url: "https://api.example/1/meta",
          },
        ],
      },
    };
    const scoped = {
      ...initial,
      protocol_version: 1,
      queue: {
        ...initial.queue,
        revision: 1,
        items: [
          ...initial.queue.items,
          {
            item_id: "track-2-1",
            track_id: 2,
            title: "Track 2",
            artist: "Artist",
            content_type: "audio/mpeg",
            stream_url: "https://api.example/2",
            metadata_url: "https://api.example/2/meta",
          },
        ],
      },
    };
    apiMock.mockResolvedValueOnce(initial).mockResolvedValueOnce({
      mutation_status: "applied",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify(scoped), { status: 200 }),
    );
    const track = (id: number) => ({
      id: `track-${id}`,
      libraryTrackId: id,
      title: `Track ${id}`,
      artist: "Artist",
    });

    await startCastSession({ track: track(1) });
    const result = await syncCustomCastQueue({
      queue: [track(1), track(2)],
      currentIndex: 0,
      repeatMode: "off",
      shuffle: false,
    });

    expect(result).toMatchObject({ ok: false });
    expect(nativeGetQueueSnapshotMock).toHaveBeenCalledTimes(3);
    expect(nativeQueueInsertMock).not.toHaveBeenCalled();
  });

  it("uses native queue navigation for a custom receiver session", async () => {
    runtimeMock.isNative = true;
    vi.stubEnv("VITE_CAST_CUSTOM_RECEIVER_ENABLED", "true");
    vi.stubEnv("VITE_CAST_RECEIVER_APP_ID", "ABCD1234");
    nativeCapabilitiesMock.mockResolvedValue({
      platform: "native",
      visible: true,
      available: true,
      activeSession: false,
      receiverApplicationId: "ABCD1234",
    });
    nativeRequestSessionMock.mockResolvedValue({ ok: true });
    for (const mock of [
      nativeQueueNextMock,
      nativeQueuePreviousMock,
      nativeQueueJumpToMock,
    ]) {
      mock.mockResolvedValue({ ok: true });
    }
    apiMock.mockResolvedValue({
      session_id: "native-navigation",
      lease: "lease",
      bootstrap_url: "https://api.example/api/cast/sessions/navigation",
      receiver_application_id: "ABCD1234",
      queue: {
        revision: 0,
        state_seq: 0,
        current_index: 0,
        current_time: 0,
        repeat_mode: "off",
        shuffle: false,
        items: [
          {
            item_id: "track-1-1",
            track_id: 1,
            title: "Track 1",
            artist: "Artist",
            content_type: "audio/mpeg",
            stream_url: "https://api.example/1",
            metadata_url: "https://api.example/1/meta",
          },
        ],
      },
    });
    await startCastSession({
      track: {
        id: "track-1",
        libraryTrackId: 1,
        title: "Track 1",
        artist: "Artist",
      },
    });

    await expect(castQueueNext()).resolves.toEqual({ ok: true });
    await expect(castQueuePrevious()).resolves.toEqual({ ok: true });
    await expect(castQueueJumpTo(2)).resolves.toEqual({ ok: true });

    expect(nativeQueueNextMock).toHaveBeenCalledOnce();
    expect(nativeQueuePreviousMock).toHaveBeenCalledOnce();
    expect(nativeQueueJumpToMock).toHaveBeenCalledWith({ index: 2 });
  });

  it("serializes native queue navigation behind an in-flight mutation", async () => {
    runtimeMock.isNative = true;
    vi.stubEnv("VITE_CAST_CUSTOM_RECEIVER_ENABLED", "true");
    vi.stubEnv("VITE_CAST_RECEIVER_APP_ID", "ABCD1234");
    nativeCapabilitiesMock.mockResolvedValue({
      platform: "native",
      visible: true,
      available: true,
      activeSession: false,
      receiverApplicationId: "ABCD1234",
    });
    nativeRequestSessionMock.mockResolvedValue({ ok: true });
    nativeQueueNextMock.mockResolvedValue({ ok: true });
    nativeGetQueueSnapshotMock.mockResolvedValue({
      available: true,
      items: [{ stableId: "track-1-1", itemId: 41 }],
    });
    const initial = {
      session_id: "native-serialized",
      lease: "lease",
      bootstrap_url: "https://api.example/cast/native-serialized",
      receiver_application_id: "ABCD1234",
      queue: {
        revision: 0,
        state_seq: 0,
        current_index: 0,
        current_time: 0,
        repeat_mode: "off" as const,
        shuffle: false,
        items: [
          {
            item_id: "track-1-1",
            track_id: 1,
            title: "Track",
            artist: "Artist",
            content_type: "audio/mpeg",
            stream_url: "https://api.example/track",
            metadata_url: "https://api.example/track/meta",
          },
        ],
      },
    };
    let resolveMutation: ((value: unknown) => void) | undefined;
    apiMock.mockResolvedValueOnce(initial).mockReturnValueOnce(
      new Promise((resolve) => {
        resolveMutation = resolve;
      }),
    );
    vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ...initial,
          protocol_version: 1,
          queue: { ...initial.queue, revision: 1 },
        }),
        { status: 200 },
      ),
    );
    const track = {
      id: "track-1",
      libraryTrackId: 1,
      title: "Track",
      artist: "Artist",
    };
    await startCastSession({ track });

    const mutation = syncCustomCastQueue({
      queue: [track],
      currentIndex: 0,
      repeatMode: "off",
      shuffle: false,
    });
    await vi.waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    const navigation = castQueueNext();

    expect(nativeQueueNextMock).not.toHaveBeenCalled();
    resolveMutation!({ mutation_status: "applied" });
    await expect(mutation).resolves.toEqual({ ok: true });
    await expect(navigation).resolves.toEqual({ ok: true });
    expect(nativeQueueNextMock).toHaveBeenCalledOnce();
  });

  it("separates disconnect from stopping and revoking custom Cast", async () => {
    vi.stubEnv("VITE_CAST_CUSTOM_RECEIVER_ENABLED", "true");
    vi.stubEnv("VITE_CAST_RECEIVER_APP_ID", "ABCD1234");
    const stop = vi.fn((_request: unknown, success: () => void) => success());
    const endCurrentSession = vi.fn();
    const session = {
      getMediaSession: () => ({ stop }),
      getSessionObj: () => ({
        queueLoad: (
          _items: unknown[],
          _repeat: string,
          _index: number,
          _time: number,
          _customData: unknown,
          success: () => void,
        ) => success(),
      }),
    };
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => session),
      requestSession: vi.fn(async () => session),
      endCurrentSession,
    };
    class MediaInfo {
      customData?: unknown;
      metadata?: unknown;
      constructor(
        public contentId: string,
        public contentType: string,
      ) {}
    }
    Object.assign(window, {
      cast: { framework: { CastContext: { getInstance: () => context } } },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          Image: class {},
          media: {
            DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845",
            MediaInfo,
            MusicTrackMediaMetadata: class {},
            QueueItem: class {
              constructor(public media: MediaInfo) {}
            },
            RepeatMode: { OFF: "OFF", ALL: "ALL", SINGLE: "SINGLE" },
            StopRequest: class {},
          },
        },
      },
    });
    apiMock.mockResolvedValue({
      session_id: "session-2",
      lease: "lease",
      bootstrap_url: "https://api.example/api/cast/sessions/lease",
      receiver_application_id: "ABCD1234",
      queue: {
        revision: 0,
        state_seq: 0,
        current_index: 0,
        current_time: 0,
        repeat_mode: "off",
        shuffle: false,
        items: [
          {
            item_id: "one",
            title: "One",
            artist: "Artist",
            content_type: "audio/mpeg",
            stream_url: "https://api.example/one",
            metadata_url: "https://api.example/one/meta",
          },
        ],
      },
    });
    const payload = {
      track: { id: "one", libraryTrackId: 1, title: "One", artist: "Artist" },
    };

    await startCastSession(payload);
    apiMock.mockClear();
    await disconnectCastSession();
    expect(endCurrentSession).toHaveBeenLastCalledWith(false);
    expect(stop).not.toHaveBeenCalled();
    expect(apiMock).not.toHaveBeenCalled();

    await startCastSession(payload);
    apiMock.mockClear();
    await stopCastSession();
    expect(stop).toHaveBeenCalledOnce();
    expect(apiMock).toHaveBeenCalledWith(
      "/api/me/cast/sessions/session-2",
      "DELETE",
    );
    expect(endCurrentSession).toHaveBeenLastCalledWith(true);
  });

  it("sends media controls to the active web Cast session", async () => {
    const calls: string[] = [];
    const media = {
      pause: (_request: unknown, success: () => void) => {
        calls.push("pause");
        success();
      },
      play: (_request: unknown, success: () => void) => {
        calls.push("play");
        success();
      },
      seek: (request: { currentTime?: number }, success: () => void) => {
        calls.push(`seek:${request.currentTime}`);
        success();
      },
      setVolume: (
        request: { volume?: { level?: number } },
        success: () => void,
      ) => {
        calls.push(`volume:${request.volume?.level}`);
        success();
      },
      stop: (_request: unknown, success: () => void) => {
        calls.push("stop");
        success();
      },
    };
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => ({
        getMediaSession: () => media,
        getCastDevice: () => ({ friendlyName: "Living Room" }),
      })),
      requestSession: vi.fn(),
    };
    Object.assign(window, {
      cast: {
        framework: {
          CastContext: {
            getInstance: () => context,
          },
        },
      },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          Volume: class {
            level?: number;
            muted?: boolean;
            constructor(level?: number, muted?: boolean) {
              this.level = level;
              this.muted = muted;
            }
          },
          media: {
            DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845",
            PauseRequest: class {},
            PlayRequest: class {},
            SeekRequest: class {
              currentTime?: number;
            },
            StopRequest: class {},
            VolumeRequest: class {
              volume: { level?: number };
              constructor(volume: { level?: number }) {
                this.volume = volume;
              }
            },
            LoadRequest: class {},
            MediaInfo: class {},
            MusicTrackMediaMetadata: class {},
          },
        },
      },
    });

    expect(isCastSessionActive()).toBe(true);
    await expect(castPause()).resolves.toEqual({ ok: true });
    await expect(castSeek(42)).resolves.toEqual({ ok: true });
    await expect(castSetVolume(0.7)).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["pause", "seek:42", "volume:0.7"]);
  });

  it("publishes estimated progress from the active web Cast media", async () => {
    vi.useFakeTimers();
    let estimatedTime = 12.5;
    const updateListeners = new Set<(isAlive: boolean) => void>();
    const media = {
      currentTime: 12,
      playerState: "PLAYING",
      media: { duration: 180 },
      volume: { level: 0.65 },
      getEstimatedTime: () => estimatedTime,
      addUpdateListener: vi.fn((listener: (isAlive: boolean) => void) => {
        updateListeners.add(listener);
      }),
      removeUpdateListener: vi.fn((listener: (isAlive: boolean) => void) => {
        updateListeners.delete(listener);
      }),
    };
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => ({
        getMediaSession: () => media,
        getCastDevice: () => ({ friendlyName: "Living Room" }),
      })),
      requestSession: vi.fn(),
      addEventListener: vi.fn(),
    };
    Object.assign(window, {
      cast: {
        framework: {
          CastContext: { getInstance: () => context },
          CastContextEventType: {
            CAST_STATE_CHANGED: "CAST_STATE_CHANGED",
            SESSION_STATE_CHANGED: "SESSION_STATE_CHANGED",
          },
        },
      },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          media: { DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845" },
        },
      },
    });
    const listener = vi.fn();

    const unsubscribe = subscribeCastPlaybackState(listener);

    expect(listener).toHaveBeenLastCalledWith({
      active: true,
      currentTime: 12.5,
      duration: 180,
      isBuffering: false,
      isPlaying: true,
      volume: 0.65,
    });
    estimatedTime = 13;
    await vi.advanceTimersByTimeAsync(500);
    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({ currentTime: 13 }),
    );

    unsubscribe();
    expect(media.removeUpdateListener).toHaveBeenCalledOnce();
  });

  it("prefers monotonic receiver status for a custom Cast session", () => {
    const messageListeners = new Map<
      string,
      (namespace: string, message: string) => void
    >();
    const media = {
      currentItemId: 41,
      items: [{ itemId: 41 }, { itemId: 42 }],
      currentTime: 4,
      playerState: "PLAYING",
      media: {
        duration: 180,
        customData: {
          crateCast: { protocolVersion: 1, sessionId: "session-status" },
        },
      },
      addUpdateListener: vi.fn(),
      removeUpdateListener: vi.fn(),
    };
    const session = {
      getMediaSession: () => media,
      addMessageListener: vi.fn(
        (
          namespace: string,
          listener: (namespace: string, message: string) => void,
        ) => {
          messageListeners.set(namespace, listener);
        },
      ),
      removeMessageListener: vi.fn(),
    };
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => session),
      requestSession: vi.fn(),
    };
    Object.assign(window, {
      cast: { framework: { CastContext: { getInstance: () => context } } },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          media: { DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845" },
        },
      },
    });
    const listener = vi.fn();
    const unsubscribe = subscribeCastPlaybackState(listener);
    const onMessage = messageListeners.get(
      "urn:x-cast:app.cratemusic.crate.v1",
    );

    onMessage?.(
      "urn:x-cast:app.cratemusic.crate.v1",
      JSON.stringify({
        version: 1,
        messageId: "status-9",
        type: "receiver.status",
        sessionId: "session-status",
        queueRevision: 4,
        stateSeq: 9,
        currentIndex: 1,
        currentTime: 46,
        playerState: "PAUSED",
        consecutiveFailures: 0,
      }),
    );
    onMessage?.(
      "urn:x-cast:app.cratemusic.crate.v1",
      JSON.stringify({
        version: 1,
        messageId: "status-8",
        type: "receiver.status",
        sessionId: "session-status",
        queueRevision: 4,
        stateSeq: 8,
        currentIndex: 0,
        currentTime: 8,
        playerState: "PLAYING",
        consecutiveFailures: 0,
      }),
    );

    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentIndex: 1,
        currentTime: 46,
        isPlaying: false,
      }),
    );
    unsubscribe();
    expect(session.removeMessageListener).toHaveBeenCalledOnce();
  });

  it("publishes native media state and prefers monotonic receiver status", async () => {
    runtimeMock.isNative = true;
    nativeCapabilitiesMock.mockResolvedValue({
      platform: "native",
      visible: true,
      available: true,
      activeSession: true,
    });
    await getCastSenderCapabilities();
    sessionChangedListeners.forEach((listener) =>
      listener({
        active: true,
        sessionId: "native-status",
        bootstrapUrl: "https://api.example/cast/native-status",
      }),
    );
    const listener = vi.fn();

    const unsubscribe = subscribeCastPlaybackState(listener);
    nativePlaybackStateListeners[nativePlaybackStateListeners.length - 1]?.({
      active: true,
      currentIndex: 0,
      currentTime: 12,
      duration: 180,
      isBuffering: false,
      isPlaying: true,
      volume: 0.6,
    });
    nativeProtocolMessageListeners[nativeProtocolMessageListeners.length - 1]?.(
      {
        namespace: "urn:x-cast:app.cratemusic.crate.v1",
        message: JSON.stringify({
          version: 1,
          messageId: "native-status-5",
          type: "receiver.status",
          sessionId: "native-status",
          queueRevision: 2,
          stateSeq: 5,
          currentIndex: 1,
          currentTime: 44,
          playerState: "PAUSED",
          consecutiveFailures: 0,
        }),
      },
    );
    nativeProtocolMessageListeners[nativeProtocolMessageListeners.length - 1]?.(
      {
        namespace: "urn:x-cast:app.cratemusic.crate.v1",
        message: JSON.stringify({
          version: 1,
          messageId: "native-status-4",
          type: "receiver.status",
          sessionId: "native-status",
          queueRevision: 2,
          stateSeq: 4,
          currentIndex: 0,
          currentTime: 2,
          playerState: "PLAYING",
          consecutiveFailures: 0,
        }),
      },
    );
    nativeProtocolMessageListeners[nativeProtocolMessageListeners.length - 1]?.(
      {
        namespace: "urn:x-cast:app.cratemusic.crate.v1",
        message: JSON.stringify({
          version: 1,
          messageId: "native-status-next-revision",
          type: "receiver.status",
          sessionId: "native-status",
          queueRevision: 3,
          stateSeq: 1,
          currentIndex: 2,
          currentTime: 3,
          playerState: "PLAYING",
          consecutiveFailures: 0,
        }),
      },
    );

    expect(listener).toHaveBeenLastCalledWith({
      active: true,
      currentIndex: 2,
      currentTime: 3,
      duration: 180,
      isBuffering: false,
      isPlaying: true,
      volume: 0.6,
    });
    unsubscribe();
  });

  it("resets native receiver ordering when the active session changes", async () => {
    runtimeMock.isNative = true;
    nativeCapabilitiesMock.mockResolvedValue({
      platform: "native",
      visible: true,
      available: true,
      activeSession: true,
    });
    await getCastSenderCapabilities();
    sessionChangedListeners.forEach((listener) =>
      listener({
        active: true,
        sessionId: "native-old",
        bootstrapUrl: "https://api.example/cast/native-old",
      }),
    );
    const listener = vi.fn();
    const unsubscribe = subscribeCastPlaybackState(listener);
    const playbackListener =
      nativePlaybackStateListeners[nativePlaybackStateListeners.length - 1];
    const protocolListener =
      nativeProtocolMessageListeners[nativeProtocolMessageListeners.length - 1];

    playbackListener?.({
      active: true,
      currentIndex: 0,
      currentTime: 10,
      duration: 180,
      isBuffering: false,
      isPlaying: true,
    });
    protocolListener?.({
      namespace: "urn:x-cast:app.cratemusic.crate.v1",
      message: JSON.stringify({
        version: 1,
        messageId: "native-old-99",
        type: "receiver.status",
        sessionId: "native-old",
        queueRevision: 9,
        stateSeq: 99,
        currentIndex: 0,
        currentTime: 90,
        playerState: "PLAYING",
        consecutiveFailures: 0,
      }),
    });

    sessionChangedListeners.forEach((sessionListener) =>
      sessionListener({
        active: true,
        sessionId: "native-new",
        bootstrapUrl: "https://api.example/cast/native-new",
      }),
    );
    protocolListener?.({
      namespace: "urn:x-cast:app.cratemusic.crate.v1",
      message: JSON.stringify({
        version: 1,
        messageId: "native-new-1",
        type: "receiver.status",
        sessionId: "native-new",
        queueRevision: 0,
        stateSeq: 1,
        currentIndex: 1,
        currentTime: 2,
        playerState: "PAUSED",
        consecutiveFailures: 0,
      }),
    });

    expect(listener).toHaveBeenLastCalledWith(
      expect.objectContaining({
        currentIndex: 1,
        currentTime: 2,
        isPlaying: false,
      }),
    );
    unsubscribe();
  });

  it("uses CAF queue navigation for a custom receiver session", async () => {
    const calls: string[] = [];
    const items = [{ itemId: 41 }, { itemId: 42 }];
    const media = {
      currentItemId: 41,
      items,
      media: {
        customData: {
          crateCast: { protocolVersion: 1, sessionId: "session-queue" },
        },
      },
      queueNext: (success: () => void) => {
        calls.push("next");
        success();
      },
      queuePrev: (success: () => void) => {
        calls.push("previous");
        success();
      },
      queueJumpToItem: (itemId: number, success: () => void) => {
        calls.push(`jump:${itemId}`);
        success();
      },
    };
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => ({ getMediaSession: () => media })),
      requestSession: vi.fn(),
    };
    Object.assign(window, {
      cast: { framework: { CastContext: { getInstance: () => context } } },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          media: { DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845" },
        },
      },
    });

    await expect(castQueueNext()).resolves.toEqual({ ok: true });
    await expect(castQueuePrevious()).resolves.toEqual({ ok: true });
    await expect(castQueueJumpTo(1)).resolves.toEqual({ ok: true });
    await expect(castQueueJumpTo(4)).resolves.toMatchObject({ ok: false });
    expect(calls).toEqual(["next", "previous", "jump:42"]);
  });

  it("ends the active web Cast session", async () => {
    let activeSession: object | null = {};
    const endCurrentSession = vi.fn(() => {
      activeSession = null;
    });
    const context = {
      setOptions: vi.fn(),
      getCurrentSession: vi.fn(() => activeSession),
      requestSession: vi.fn(),
      endCurrentSession,
    };
    Object.assign(window, {
      cast: {
        framework: {
          CastContext: {
            getInstance: () => context,
          },
        },
      },
      chrome: {
        cast: {
          AutoJoinPolicy: { ORIGIN_SCOPED: "origin_scoped" },
          media: { DEFAULT_MEDIA_RECEIVER_APP_ID: "CC1AD845" },
        },
      },
    });

    await expect(endCastSession()).resolves.toEqual({ ok: true });
    expect(endCurrentSession).toHaveBeenCalledWith(true);
    expect(isCastSessionActive()).toBe(false);
  });

  it("reflects a native session ending for reasons the app never asked for", async () => {
    runtimeMock.isNative = true;
    nativeControlMock.mockResolvedValue({ ok: true });

    // Establish a session the way the app normally would.
    await castPlay();
    expect(isCastSessionActive()).toBe(true);

    // The native side ends the session on its own (receiver closed
    // remotely, TV turned off, route dropped) and notifies listeners —
    // before this fix, isCastSessionActive() had no way to hear about it.
    expect(sessionChangedListeners.length).toBeGreaterThan(0);
    sessionChangedListeners.forEach((listener) => listener({ active: false }));

    expect(isCastSessionActive()).toBe(false);
  });

  it("does not treat a successful stop as the Cast session ending", async () => {
    runtimeMock.isNative = true;
    nativeControlMock.mockResolvedValue({ ok: true });

    await castPlay();
    expect(isCastSessionActive()).toBe(true);

    // stop() only stops the receiver's current media — it does not end
    // the Cast session, so the app should still be able to play again
    // without re-picking a device.
    await expect(castStop()).resolves.toEqual({ ok: true });
    expect(isCastSessionActive()).toBe(true);
  });

  it("does not treat a rejected command as the Cast session ending", async () => {
    runtimeMock.isNative = true;
    nativeControlMock.mockResolvedValue({ ok: true });

    await castPlay();
    expect(isCastSessionActive()).toBe(true);

    // A transient pause rejection (e.g. the receiver briefly refused the
    // command) is not proof the device disconnected — only the
    // sessionChanged listener or a fresh capabilities read gets to say
    // that.
    nativeControlMock.mockResolvedValueOnce({
      ok: false,
      message: "Cast command was rejected by the receiver.",
    });
    await expect(castPause()).resolves.toEqual({
      ok: false,
      message: "Cast command was rejected by the receiver.",
    });
    expect(isCastSessionActive()).toBe(true);
  });

  it("does not let a late command success resurrect a disconnected session", async () => {
    runtimeMock.isNative = true;
    let resolveCommand: ((result: { ok: boolean }) => void) | undefined;
    nativeControlMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveCommand = resolve;
      }),
    );

    const command = castPlay();
    await vi.waitFor(() => expect(nativeControlMock).toHaveBeenCalled());
    sessionChangedListeners.forEach((listener) => listener({ active: false }));
    resolveCommand!({ ok: true });

    await expect(command).resolves.toEqual({ ok: true });
    expect(isCastSessionActive()).toBe(false);
  });

  it("does not let a late session request resurrect a disconnected session", async () => {
    runtimeMock.isNative = true;
    nativeCapabilitiesMock.mockResolvedValue({
      platform: "native",
      visible: true,
      available: true,
      activeSession: false,
    });
    apiMock.mockResolvedValue({
      stream_url: "https://stream.example/track",
      metadata_url: "https://stream.example/metadata",
      expires_at: "2030-01-01T00:00:00Z",
      delivery_policy: "direct",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          stream_url: "https://stream.example/track",
          title: "Track",
          artist: "Artist",
        }),
        { status: 200 },
      ),
    );
    let resolveSession: ((result: { ok: boolean }) => void) | undefined;
    nativeRequestSessionMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );

    const request = startCastSession({
      track: {
        id: "track-1",
        libraryTrackId: 1,
        title: "Track",
        artist: "Artist",
      },
    });
    await vi.waitFor(() => expect(nativeRequestSessionMock).toHaveBeenCalled());
    sessionChangedListeners.forEach((listener) => listener({ active: false }));
    resolveSession!({ ok: true });

    await expect(request).resolves.toEqual({ ok: true });
    expect(isCastSessionActive()).toBe(false);
  });

  it("cancels and revokes a custom native start overtaken by disconnect", async () => {
    runtimeMock.isNative = true;
    vi.stubEnv("VITE_CAST_CUSTOM_RECEIVER_ENABLED", "true");
    vi.stubEnv("VITE_CAST_RECEIVER_APP_ID", "ABCD1234");
    nativeCapabilitiesMock.mockResolvedValue({
      platform: "native",
      visible: true,
      available: true,
      activeSession: false,
      receiverApplicationId: "ABCD1234",
    });
    nativeEndSessionMock.mockResolvedValue({ ok: true });
    apiMock.mockResolvedValueOnce({
      session_id: "native-overtaken",
      lease: "lease",
      bootstrap_url: "https://api.example/cast/native-overtaken",
      receiver_application_id: "ABCD1234",
      queue: {
        revision: 0,
        state_seq: 0,
        current_index: 0,
        current_time: 0,
        repeat_mode: "off",
        shuffle: false,
        items: [
          {
            item_id: "track-1-1",
            track_id: 1,
            title: "Track",
            artist: "Artist",
            content_type: "audio/mpeg",
            stream_url: "https://api.example/track",
            metadata_url: "https://api.example/track/meta",
          },
        ],
      },
    });
    let resolveSession: ((result: { ok: boolean }) => void) | undefined;
    nativeRequestSessionMock.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveSession = resolve;
      }),
    );

    const starting = startCastSession({
      track: {
        id: "track-1",
        libraryTrackId: 1,
        title: "Track",
        artist: "Artist",
      },
    });
    await vi.waitFor(() => expect(nativeRequestSessionMock).toHaveBeenCalled());
    await disconnectCastSession();
    resolveSession!({ ok: true });

    await expect(starting).resolves.toMatchObject({
      ok: false,
      message: "Cast start was cancelled.",
    });
    expect(isCastSessionActive()).toBe(false);
    expect(isCustomCastSessionActive()).toBe(false);
    expect(apiMock).toHaveBeenLastCalledWith(
      "/api/me/cast/sessions/native-overtaken",
      "DELETE",
    );
  });

  it("serves protected Crate artwork from the receiver-reachable origin", async () => {
    runtimeMock.isNative = true;
    nativeCapabilitiesMock.mockResolvedValue({
      platform: "native",
      visible: true,
      available: true,
      activeSession: false,
    });
    nativeRequestSessionMock.mockResolvedValue({ ok: true });
    apiMock.mockResolvedValue({
      stream_url: "http://192.168.1.246:8585/api/cast/stream/ticket",
      metadata_url: "https://stream.example/metadata",
      expires_at: "2030-01-01T00:00:00Z",
      delivery_policy: "direct",
    });
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          stream_url: "http://192.168.1.246:8585/api/cast/stream/ticket",
          title: "Track",
          artist: "Artist",
        }),
        { status: 200 },
      ),
    );

    await startCastSession({
      track: {
        id: "track-1",
        libraryTrackId: 1,
        title: "Track",
        artist: "Artist",
        albumCover: "/api/catalog/albums/album-1/cover?size=512",
      },
    });

    expect(ensureMediaAccessUrlMock).toHaveBeenCalledWith(
      "https://crate.test/api/catalog/albums/album-1/cover?size=512",
      "artwork",
    );
    expect(nativeRequestSessionMock).toHaveBeenCalledWith(
      expect.objectContaining({
        artworkUrl:
          "http://192.168.1.246:8585/api/catalog/albums/album-1/cover?size=512&media_ticket=artwork-ticket",
      }),
    );
  });
});
