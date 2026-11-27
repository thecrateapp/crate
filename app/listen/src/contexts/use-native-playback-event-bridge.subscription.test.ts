import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UseNativePlaybackEventBridgeParams } from "@/contexts/use-native-playback-event-bridge";

const subscriptions: Array<{
  handlers: Record<string, (event: unknown) => void>;
  dispose: ReturnType<typeof vi.fn>;
}> = [];

const notifyMock = vi.hoisted(() => ({ error: vi.fn(), info: vi.fn() }));
vi.mock("@crate/ui/lib/notify", () => ({ notify: notifyMock }));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock("@/contexts/subscribe-native-player-events", () => ({
  subscribeNativePlayerEvents: (
    _engine: unknown,
    handlers: Record<string, (event: unknown) => void>,
  ) => {
    const subscription = { handlers, dispose: vi.fn() };
    subscriptions.push(subscription);
    return { ready: Promise.resolve(), dispose: subscription.dispose };
  },
}));

vi.mock("@/lib/android-native-engine", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/android-native-engine")>()),
  shouldUseAndroidNativePlayer: () => true,
  androidNativeEngine: {
    acknowledgeEvents: vi.fn().mockResolvedValue(undefined),
    drainEvents: vi.fn().mockResolvedValue([]),
    getDurableEvents: vi.fn().mockResolvedValue([]),
    getState: vi.fn().mockResolvedValue(null),
    planAhead: vi.fn(),
    isCurrentQueueRevision: (revision: string) => revision === "queue-a",
  },
}));

function params(
  overrides: Partial<UseNativePlaybackEventBridgeParams> = {},
): UseNativePlaybackEventBridgeParams {
  return {
    applyNativePosition: vi.fn(),
    applyNativeState: vi.fn(),
    applyNativeTrackChange: vi.fn(),
    beginSoftInterruption: vi.fn(),
    bufferingIntentRef: { current: false },
    clearNativeBufferingWatchdog: vi.fn(),
    commitIsBuffering: vi.fn(),
    commitIsPlaying: vi.fn(),
    crossfadeTimerRef: { current: null },
    currentIndexRef: { current: 0 },
    durationRef: { current: 0 },
    flushCurrentPlayEvent: vi.fn(),
    isNativeEventStale: () => false,
    queueRef: { current: [] },
    recoverNativeBuffering: vi.fn().mockResolvedValue(true),
    retryNativePlaybackAfterAuthError: () => false,
    scheduleNativeBufferingWatchdog: vi.fn(),
    setCrossfadeTransition: vi.fn(),
    ...overrides,
  };
}

describe("useNativePlaybackEventBridge subscription", () => {
  afterEach(() => {
    subscriptions.length = 0;
  });

  it("subscribes once and routes events to the latest callbacks", async () => {
    const { useNativePlaybackEventBridge } =
      await import("@/contexts/use-native-playback-event-bridge");
    const first = params();
    const { rerender, unmount } = renderHook(
      (props: UseNativePlaybackEventBridgeParams) =>
        useNativePlaybackEventBridge(props),
      { initialProps: first },
    );
    const latestTrackChange = vi.fn();
    rerender(params({ applyNativeTrackChange: latestTrackChange }));
    rerender(params({ applyNativeTrackChange: latestTrackChange }));

    await vi.waitFor(() => expect(subscriptions).toHaveLength(1));
    subscriptions[0]?.handlers.trackChanged?.({ index: 3 });
    expect(latestTrackChange).toHaveBeenCalledWith({ index: 3 });
    const { androidNativeEngine } = await import("@/lib/android-native-engine");
    expect(androidNativeEngine.planAhead).toHaveBeenCalledWith(3);
    expect(first.applyNativeTrackChange).not.toHaveBeenCalled();

    unmount();
    expect(subscriptions[0]?.dispose).toHaveBeenCalledTimes(1);
  });

  it("adopts natively appended tracks before reconciling on resume", async () => {
    const { useNativePlaybackEventBridge } =
      await import("@/contexts/use-native-playback-event-bridge");
    const { androidNativeEngine } = await import("@/lib/android-native-engine");
    const order: string[] = [];
    vi.mocked(androidNativeEngine.getState).mockImplementation(() => {
      order.push("reconcile");
      return Promise.resolve(null);
    });
    const adoptNativeAppendedTracks = vi.fn(async () => {
      order.push("adopt");
    });
    const { unmount } = renderHook(() =>
      useNativePlaybackEventBridge(params({ adoptNativeAppendedTracks })),
    );
    await vi.waitFor(() => expect(order).toContain("reconcile"));
    order.length = 0;

    window.dispatchEvent(new CustomEvent("crate:app-resumed"));

    await vi.waitFor(() => expect(order).toEqual(["adopt", "reconcile"]));
    unmount();
  });

  it("applies events buffered by native before the first reconcile learns the queue revision", async () => {
    const { useNativePlaybackEventBridge } =
      await import("./use-native-playback-event-bridge");
    const { androidNativeEngine } = await import("@/lib/android-native-engine");
    const engine = androidNativeEngine as unknown as {
      isCurrentQueueRevision: (revision: string) => boolean;
    };
    const original = engine.isCurrentQueueRevision;
    let known = "";
    engine.isCurrentQueueRevision = (revision) => !known || revision === known;
    vi.mocked(androidNativeEngine.drainEvents).mockResolvedValueOnce([
      {
        event: "playEventCheckpoint",
        payload: { revision: "queue-a", nativeSequence: 1, positionMs: 30000 },
      },
      {
        event: "trackChanged",
        payload: { revision: "queue-a", nativeSequence: 2, index: 1 },
      },
    ] as never);
    vi.mocked(androidNativeEngine.getState).mockImplementationOnce(async () => {
      known = "queue-a";
      return null;
    });
    const applyNativePosition = vi.fn();
    const applyNativeTrackChange = vi.fn();
    const { unmount } = renderHook(() =>
      useNativePlaybackEventBridge(
        params({
          applyNativePosition,
          applyNativeTrackChange,
          setMixState: vi.fn(),
        }),
      ),
    );

    await vi.waitFor(() => expect(known).toBe("queue-a"));
    expect(applyNativePosition).toHaveBeenCalledWith(
      expect.objectContaining({ positionMs: 30000 }),
    );
    expect(applyNativeTrackChange).toHaveBeenCalledWith(
      expect.objectContaining({ index: 1 }),
    );
    engine.isCurrentQueueRevision = original;
    unmount();
  });

  it("rejects old-queue side effects before they consume freshness or clear current telemetry", async () => {
    const { useNativePlaybackEventBridge } =
      await import("./use-native-playback-event-bridge");
    const setMixState = vi.fn();
    const isNativeEventStale = vi.fn(() => false);
    const { unmount } = renderHook(() =>
      useNativePlaybackEventBridge(params({ setMixState, isNativeEventStale })),
    );
    await vi.waitFor(() => expect(setMixState).toHaveBeenCalledWith(null));
    setMixState.mockClear();
    act(() =>
      subscriptions[0]?.handlers.queueEnded?.({
        revision: "old-queue",
        nativeSequence: 99,
      }),
    );
    expect(setMixState).not.toHaveBeenCalled();
    expect(isNativeEventStale).not.toHaveBeenCalled();
    unmount();
  });
  it.each(["transitionEnded", "transitionCancelled", "transitionStarted"])(
    "keeps newer Gapless telemetry when a legacy %s arrives afterwards",
    async (eventName) => {
      const { useNativePlaybackEventBridge } =
        await import("./use-native-playback-event-bridge");
      const applyNativeMixState = vi.fn();
      const setMixState = vi.fn();
      const { unmount } = renderHook(() =>
        useNativePlaybackEventBridge(
          params({ applyNativeMixState, setMixState }),
        ),
      );
      await vi.waitFor(() => expect(setMixState).toHaveBeenCalledWith(null));
      setMixState.mockClear();
      const gapless = {
        revision: "queue-a",
        nativeSequence: 20,
        mixState: {
          revision: "queue-a",
          executionId: 4,
          mode: "gapless",
          phase: "idle",
          bassHandoff: false,
        },
      };
      act(() => {
        subscriptions[0]?.handlers.mixStateChanged?.(gapless);
        subscriptions[0]?.handlers[eventName]?.({
          revision: "queue-a",
          nativeSequence: 21,
          type: "manual",
        });
      });
      expect(applyNativeMixState).toHaveBeenCalledWith(gapless);
      expect(setMixState).not.toHaveBeenCalled();
      unmount();
    },
  );

  it("clears uncertain execution immediately on resume before applying the native snapshot", async () => {
    const { useNativePlaybackEventBridge } =
      await import("./use-native-playback-event-bridge");
    const { androidNativeEngine } = await import("@/lib/android-native-engine");
    const setMixState = vi.fn();
    const applyNativeState = vi.fn();
    const { unmount } = renderHook(() =>
      useNativePlaybackEventBridge(params({ setMixState, applyNativeState })),
    );
    await vi.waitFor(() => expect(setMixState).toHaveBeenCalledWith(null));
    setMixState.mockClear();
    let resolve!: (state: never) => void;
    vi.mocked(androidNativeEngine.getState).mockImplementationOnce(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    act(() => window.dispatchEvent(new Event("crate:app-resumed")));
    await vi.waitFor(() => expect(setMixState).toHaveBeenCalledWith(null));
    expect(applyNativeState).not.toHaveBeenCalled();
    const state = { revision: "queue-a", mixState: null };
    await act(async () => resolve(state as never));
    expect(applyNativeState).toHaveBeenCalledWith(state, expect.any(Object));
    unmount();
  });

  it("forwards live and drained actual mix envelopes without recreating listeners", async () => {
    const { useNativePlaybackEventBridge } =
      await import("./use-native-playback-event-bridge");
    const { androidNativeEngine } = await import("@/lib/android-native-engine");
    const event = {
      revision: "queue-a",
      nativeSequence: 7,
      mixState: {
        revision: "queue-a",
        executionId: 4,
        mode: "crossfade" as const,
        phase: "mixing" as const,
        bassHandoff: false,
      },
    };
    vi.mocked(androidNativeEngine.drainEvents).mockResolvedValueOnce([
      { event: "mixStateChanged", payload: event },
    ]);
    const applyNativeMixState = vi.fn();
    const { rerender, unmount } = renderHook(
      (props) => useNativePlaybackEventBridge(props),
      {
        initialProps: params({
          applyNativeMixState,
        } as Partial<UseNativePlaybackEventBridgeParams>),
      },
    );
    await vi.waitFor(() =>
      expect(applyNativeMixState).toHaveBeenCalledWith(event),
    );
    const latest = vi.fn();
    rerender(
      params({
        applyNativeMixState: latest,
      } as Partial<UseNativePlaybackEventBridgeParams>),
    );
    subscriptions[0]?.handlers.mixStateChanged?.({
      ...event,
      nativeSequence: 8,
      mixState: null,
    });
    expect(latest).toHaveBeenCalledWith({
      ...event,
      nativeSequence: 8,
      mixState: null,
    });
    expect(subscriptions).toHaveLength(1);
    unmount();
  });

  it("replays durable events from a previous process before any live listener attaches", async () => {
    const { useNativePlaybackEventBridge } =
      await import("./use-native-playback-event-bridge");
    const { androidNativeEngine } = await import("@/lib/android-native-engine");
    const checkpoint = {
      revision: "queue-a",
      nativeSequence: 40,
      index: 0,
      positionMs: 65000,
      isPlaying: true,
    };
    const trackChanged = {
      revision: "queue-a",
      nativeSequence: 41,
      index: 1,
      positionMs: 0,
      isPlaying: true,
    };
    vi.mocked(androidNativeEngine.getDurableEvents).mockResolvedValueOnce([
      { event: "playEventCheckpoint", payload: checkpoint },
      { event: "trackChanged", payload: trackChanged },
    ] as never);
    const order: string[] = [];
    const applyReplayedNativeEvent = vi.fn((eventName: string) => {
      order.push(`replay:${eventName}:${subscriptions.length}`);
    });

    const { unmount } = renderHook(() =>
      useNativePlaybackEventBridge(params({ applyReplayedNativeEvent })),
    );

    await vi.waitFor(() => expect(subscriptions).toHaveLength(1));
    expect(order).toEqual([
      "replay:playEventCheckpoint:0",
      "replay:trackChanged:0",
    ]);
    expect(applyReplayedNativeEvent).toHaveBeenCalledWith(
      "trackChanged",
      trackChanged,
    );
    expect(androidNativeEngine.acknowledgeEvents).toHaveBeenCalledWith(41);
    unmount();
  });

  it("still attaches live listeners when the durable log cannot be read", async () => {
    const { useNativePlaybackEventBridge } =
      await import("./use-native-playback-event-bridge");
    const { androidNativeEngine } = await import("@/lib/android-native-engine");
    vi.mocked(androidNativeEngine.getDurableEvents).mockRejectedValueOnce(
      new Error("bridge down"),
    );
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    const { unmount } = renderHook(() =>
      useNativePlaybackEventBridge(params()),
    );

    await vi.waitFor(() => expect(subscriptions).toHaveLength(1));
    warn.mockRestore();
    unmount();
  });

  it("acknowledges handled live play events before the WebView is hidden", async () => {
    const { useNativePlaybackEventBridge } =
      await import("./use-native-playback-event-bridge");
    const { androidNativeEngine } = await import("@/lib/android-native-engine");
    vi.mocked(androidNativeEngine.acknowledgeEvents).mockClear();
    const { unmount } = renderHook(() =>
      useNativePlaybackEventBridge(params()),
    );
    await vi.waitFor(() => expect(subscriptions).toHaveLength(1));

    act(() => {
      subscriptions[0]?.handlers.playEventCheckpoint?.({
        revision: "queue-a",
        nativeSequence: 52,
        index: 0,
        positionMs: 5000,
        isPlaying: true,
      });
      subscriptions[0]?.handlers.positionChanged?.({
        revision: "queue-a",
        nativeSequence: 53,
        index: 0,
        positionMs: 5100,
        isPlaying: true,
      });
    });
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    visibility.mockRestore();

    expect(
      androidNativeEngine.acknowledgeEvents,
    ).toHaveBeenCalledExactlyOnceWith(52);
    unmount();
  });

  it("tells the listener native resumes after a lost network instead of failing", async () => {
    const { useNativePlaybackEventBridge } =
      await import("./use-native-playback-event-bridge");
    notifyMock.error.mockClear();
    notifyMock.info.mockClear();
    const beginSoftInterruption = vi.fn();
    const commitIsPlaying = vi.fn();
    const { unmount } = renderHook(() =>
      useNativePlaybackEventBridge(
        params({ beginSoftInterruption, commitIsPlaying }),
      ),
    );
    await vi.waitFor(() => expect(subscriptions).toHaveLength(1));

    act(() => {
      subscriptions[0]?.handlers.error?.({
        revision: "queue-a",
        nativeSequence: 70,
        code: 2001,
        message: "Source error",
        cause: "java.net.UnknownHostException",
        causeMessage:
          "Unable to resolve host: android_getaddrinfo failed: EAI_NODATA",
        networkRecoverable: true,
      });
    });

    expect(notifyMock.error).not.toHaveBeenCalled();
    expect(notifyMock.info).toHaveBeenCalledWith(
      "player.native.networkLostTitle",
      expect.objectContaining({
        id: "native-network-lost",
        description: "player.native.networkLostDescription",
      }),
    );
    expect(beginSoftInterruption).not.toHaveBeenCalled();
    expect(commitIsPlaying).toHaveBeenCalledWith(false);
    unmount();
  });

  it("still reports other native failures and recovers them from JS", async () => {
    const { useNativePlaybackEventBridge } =
      await import("./use-native-playback-event-bridge");
    notifyMock.error.mockClear();
    notifyMock.info.mockClear();
    const beginSoftInterruption = vi.fn();
    const { unmount } = renderHook(() =>
      useNativePlaybackEventBridge(params({ beginSoftInterruption })),
    );
    await vi.waitFor(() => expect(subscriptions).toHaveLength(1));

    act(() => {
      subscriptions[0]?.handlers.error?.({
        revision: "queue-a",
        nativeSequence: 71,
        code: 4001,
        message: "Decoder failed",
      });
    });

    expect(notifyMock.info).not.toHaveBeenCalled();
    expect(notifyMock.error).toHaveBeenCalledWith(
      "player.native.playbackFailed",
      expect.objectContaining({ description: "Decoder failed" }),
    );
    expect(beginSoftInterruption).toHaveBeenCalledWith("stream");
    unmount();
  });
});
