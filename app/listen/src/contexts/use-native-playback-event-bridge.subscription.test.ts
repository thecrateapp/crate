import { renderHook } from "@testing-library/react";
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
    const { useNativePlaybackEventBridge } = await import(
      "@/contexts/use-native-playback-event-bridge"
    );
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
    expect(first.applyNativeTrackChange).not.toHaveBeenCalled();

    unmount();
    expect(subscriptions[0]?.dispose).toHaveBeenCalledTimes(1);
  });
});
