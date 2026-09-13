import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Track } from "@/contexts/player-types";
import { cancelNativePlaybackRecoveryIntent } from "@/lib/native-playback-intent";

const mocks = vi.hoisted(() => ({
  loadQueue: vi.fn(),
  toStartupEngineTracks: vi.fn(),
}));

vi.mock("@/contexts/player-engine-adapter", () => ({
  toStartupEngineTracks: mocks.toStartupEngineTracks,
}));

vi.mock("@/lib/android-native-engine", () => ({
  androidNativeEngine: { loadQueue: mocks.loadQueue },
  shouldUseAndroidNativePlayer: () => true,
}));

vi.mock("@/lib/offline", () => ({
  primeOfflineRuntimeProfile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@/lib/playback-delivery", () => ({
  preparePlaybackDelivery: vi.fn(),
}));

vi.mock("@/lib/gapless-player", () => ({
  loadQueue: vi.fn(),
  play: vi.fn(),
  setLoop: vi.fn(),
  setSingleMode: vi.fn(),
}));

import { usePlayerStartActions } from "./use-player-start-actions";

function createParams() {
  return {
    queueRef: { current: [] as Track[] },
    currentIndexRef: { current: 0 },
    jamQueueLockedRef: { current: false },
    repeatRef: { current: "off" as const },
    bufferingIntentRef: { current: false },
    pendingRestoreTimeRef: { current: 0 },
    resumeAfterReloadRef: { current: false },
    lastNonZeroVolumeRef: { current: 1 },
    setPlaySource: vi.fn(),
    buildEngineUrls: vi.fn(() => []),
    rememberActiveTrack: vi.fn(),
    startTrackerSession: vi.fn(),
    flushCurrentPlayEvent: vi.fn(),
    cancelSoftInterruption: vi.fn(),
    cancelRestoreAutoplay: vi.fn(),
    resetPlaybackIntelligence: vi.fn(),
    commitQueue: vi.fn(),
    commitCurrentIndex: vi.fn(),
    commitCurrentTime: vi.fn(),
    commitDuration: vi.fn(),
    commitIsPlaying: vi.fn(),
    commitIsBuffering: vi.fn(),
    pullFromEngine: vi.fn(() => ({ resolvedTrack: undefined })),
    playbackDeliveryPolicy: "balanced" as const,
    silenceGaplessEngine: vi.fn(),
    stopNativeEngineIfAvailable: vi.fn(),
  };
}

describe("usePlayerStartActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadQueue.mockResolvedValue({});
  });

  it("does not publish a native queue after the start intent is cancelled", async () => {
    const track = { id: "track-1", title: "Track" } as Track;
    let resolveTracks!: (tracks: []) => void;
    mocks.toStartupEngineTracks.mockReturnValue(
      new Promise<[]>((resolve) => {
        resolveTracks = resolve;
      }),
    );
    const { result } = renderHook(() => usePlayerStartActions(createParams()));

    act(() => result.current.play(track));
    await waitFor(() => expect(mocks.toStartupEngineTracks).toHaveBeenCalled());

    cancelNativePlaybackRecoveryIntent("pause");
    resolveTracks([]);
    await act(async () => Promise.resolve());

    expect(mocks.loadQueue).not.toHaveBeenCalled();
  });
});
