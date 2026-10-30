import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { PlaySource, Track } from "./player-types";

const mocks = vi.hoisted(() => ({
  notifyInfo: vi.fn(),
  t: vi.fn((key: string) => `localized:${key}`),
}));

vi.mock("@crate/ui/lib/notify", () => ({
  notify: { info: mocks.notifyInfo },
}));
vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: mocks.t }),
}));
vi.mock("@/lib/gapless-player", () => ({ initPlayer: () => ({}) }));
vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => false,
}));
vi.mock("@/lib/cast-sender", () => ({ isCastSessionActive: () => false }));
vi.mock("@/lib/radio-continuation", () => ({
  fetchContinuationBatch: vi.fn(),
  acknowledgeContinuationBatch: vi.fn(),
}));
vi.mock("@/contexts/use-player-engine-preference-runtime", () => ({
  usePlayerEnginePreferenceRuntime: () => {},
}));
vi.mock("@/contexts/use-playback-persistence", () => ({
  usePlaybackPersistence: () => {},
}));
vi.mock("@/hooks/use-equalizer-runtime", () => ({
  useEqualizerRuntime: () => {},
}));
vi.mock("@/contexts/use-player-playback-observability", () => ({
  usePlayerPlaybackObservability: () => ({
    startTrackerSession: vi.fn(),
    ensureTrackerSession: vi.fn(),
    flushCurrentPlayEvent: vi.fn(),
    rotateTrackerSession: vi.fn(),
    markSeekPosition: vi.fn(),
    recordProgress: vi.fn(),
    recordPlaybackQualityProgress: vi.fn(),
    recordCurrentPlaybackQoe: vi.fn(),
  }),
}));
vi.mock("@/contexts/use-player-track-recovery", () => ({
  usePlayerTrackRecovery: () => ({
    preResolveNextTrack: vi.fn(),
    recoverActiveTrackRef: { current: vi.fn() },
  }),
}));
vi.mock("@/contexts/use-soft-interruption", () => ({
  useSoftInterruption: () => ({
    beginSoftInterruption: vi.fn(),
    cancelSoftInterruption: vi.fn(),
    requireUserGestureToResume: vi.fn(),
    scheduleStallProtection: vi.fn(),
    clearStallTimer: vi.fn(),
    isSoftInterrupted: () => false,
  }),
}));
vi.mock("@/contexts/use-player-engine-sync", () => ({
  usePlayerEngineSync: () => ({
    syncEffectiveCrossfade: vi.fn(),
    rememberActiveTrack: vi.fn(),
    pullFromEngine: vi.fn(),
    pushToEngine: vi.fn(),
    advanceCursorTo: vi.fn(),
  }),
}));
vi.mock("@/contexts/use-player-intelligence-actions", () => ({
  usePlayerIntelligenceActions: () => ({
    adoptNativeTracks: vi.fn(),
    appendAndAdvance: vi.fn().mockResolvedValue(0),
    appendIntelligenceTracks: vi.fn().mockResolvedValue(0),
    insertSuggestionAfterCurrent: vi.fn(),
  }),
}));
vi.mock("@/contexts/use-native-continuation-adoption", () => ({
  useNativeContinuationAdoption: () => vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/contexts/use-native-playback-runtime", () => ({
  useNativePlaybackRuntime: () => {},
}));
vi.mock("@/contexts/use-player-preference-runtime", () => ({
  usePlayerPreferenceRuntime: () => {},
}));
vi.mock("@/contexts/use-restore-on-mount", () => ({
  useRestoreOnMount: () => ({
    pendingRestoreTimeRef: { current: 0 },
    resumeAfterReloadRef: { current: false },
    tryRestoreAutoplay: vi.fn(),
    cancelRestoreAutoplay: vi.fn(),
  }),
}));

import { fetchContinuationBatch } from "@/lib/radio-continuation";
import { STORAGE_KEY } from "./player-utils";
import { usePlayerPlaybackRuntime } from "./use-player-playback-runtime";
import { usePlayerRuntimeState } from "./use-player-runtime-state";

const track: Track = { id: "a", title: "A", artist: "X" };
const source: PlaySource = {
  type: "album",
  name: "Album",
  radio: { seedType: "album", seedId: 42 },
};

function setup() {
  const rendered = renderHook(() => {
    const state = usePlayerRuntimeState();
    const playback = usePlayerPlaybackRuntime({
      connectEnabled: false,
      runtime: state,
    });
    return { state, playback };
  });
  act(() => rendered.result.current.state.setPlaySource(source));
  const finish = async () => {
    await act(async () => {
      rendered.result.current.playback.resumePlaybackIntelligence();
      rendered.result.current.state.callbacksRef.current.onAllFinished?.();
    });
  };
  return { ...rendered, finish };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  vi.spyOn(navigator, "onLine", "get").mockReturnValue(true);
  localStorage.clear();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ queue: [track], currentIndex: 0, playSource: source }),
  );
  vi.mocked(fetchContinuationBatch)
    .mockReset()
    .mockRejectedValue(new TypeError("Network unavailable"));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("notifies once with localized copy when the real EOF refill reaches its transport limit", async () => {
  const { finish } = setup();
  await finish();
  expect(fetchContinuationBatch).toHaveBeenCalledOnce();
  expect(mocks.notifyInfo).not.toHaveBeenCalled();

  await act(async () => vi.advanceTimersByTimeAsync(15_000));

  expect(fetchContinuationBatch).toHaveBeenCalledTimes(5);
  expect(mocks.t).toHaveBeenCalledWith("player.toasts.continuationUnavailable");
  expect(mocks.notifyInfo).toHaveBeenCalledExactlyOnceWith(
    "localized:player.toasts.continuationUnavailable",
  );

  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(120_000);
  });

  expect(mocks.notifyInfo).toHaveBeenCalledOnce();
});

it.each(["exhausted", "auth_required"] as const)(
  "does not show a transport notice when EOF is terminal: %s",
  async (status) => {
    vi.mocked(fetchContinuationBatch).mockResolvedValue({
      tracks: [],
      status,
      batchIndex: 0,
    });
    const { finish } = setup();
    await finish();
    await act(async () => vi.advanceTimersByTimeAsync(120_000));

    expect(fetchContinuationBatch).toHaveBeenCalledOnce();
    expect(mocks.notifyInfo).not.toHaveBeenCalled();
  },
);

it("does not show a transport notice for a source replaced during its EOF wait", async () => {
  let reject!: (reason: Error) => void;
  vi.mocked(fetchContinuationBatch).mockImplementation(
    () =>
      new Promise((_resolve, fail) => {
        reject = fail;
      }),
  );
  const { result, finish } = setup();
  await finish();
  await act(async () => vi.advanceTimersByTimeAsync(10_000));
  act(() => {
    result.current.state.setPlaySource({
      type: "album",
      name: "Replacement",
      radio: { seedType: "album", seedId: 55 },
    });
  });
  await act(async () => {
    reject(new TypeError("Old source failed"));
    await vi.advanceTimersByTimeAsync(120_000);
  });

  expect(fetchContinuationBatch).toHaveBeenCalledOnce();
  expect(mocks.notifyInfo).not.toHaveBeenCalled();
});
