import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { UseNativePlaybackEventBridgeParams } from "@/contexts/use-native-playback-event-bridge";

const subscriptions: Array<{
  handlers: Record<string, (event: unknown) => void>;
  dispose: ReturnType<typeof vi.fn>;
}> = [];

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
    drainEvents: vi.fn().mockResolvedValue([]),
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

    expect(subscriptions).toHaveLength(1);
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
});
