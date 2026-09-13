import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/android-native-engine", () => ({
  androidNativeEngine: { setRepeat: vi.fn() },
  shouldUseAndroidNativePlayer: () => false,
}));
vi.mock("@/lib/cast-sender", () => ({
  castStop: vi.fn(),
  isCastSessionActive: () => false,
}));
vi.mock("@/lib/gapless-player", () => ({
  getPosition: () => 0,
}));

import {
  usePlayerQueueStateActions,
  type UsePlayerQueueStateActionsParams,
} from "./use-player-queue-state-actions";

function createParams(): {
  params: UsePlayerQueueStateActionsParams;
  commitQueue: ReturnType<typeof vi.fn>;
} {
  const commitQueue = vi.fn();
  return {
    commitQueue,
    params: {
      queueRef: { current: [] },
      currentIndexRef: { current: 0 },
      currentTimeRef: { current: 0 },
      isPlayingRef: { current: false },
      jamQueueLockedRef: { current: true },
      shuffleRef: { current: false },
      unshuffledQueueRef: { current: null },
      bufferingIntentRef: { current: false },
      pendingRestoreTimeRef: { current: 0 },
      resumeAfterReloadRef: { current: false },
      activatedTrackKeyRef: { current: null },
      setPlaySource: vi.fn(),
      setShuffleState: vi.fn(),
      setRepeatState: vi.fn(),
      resetEngineTrackMap: vi.fn(),
      flushCurrentPlayEvent: vi.fn(),
      cancelSoftInterruption: vi.fn(),
      cancelRestoreAutoplay: vi.fn(),
      resetPlaybackIntelligence: vi.fn(),
      commitQueue,
      commitCurrentIndex: vi.fn(),
      commitCurrentTime: vi.fn(),
      commitDuration: vi.fn(),
      commitIsPlaying: vi.fn(),
      commitIsBuffering: vi.fn(),
      pushToEngine: vi.fn(),
      silenceGaplessEngine: vi.fn(),
      stopNativeEngineIfAvailable: vi.fn(),
    },
  };
}

describe("usePlayerQueueStateActions", () => {
  it("preserves a locked Jam queue for ordinary user actions", () => {
    const { params, commitQueue } = createParams();
    const { result } = renderHook(() => usePlayerQueueStateActions(params));

    act(() => result.current.clearQueue());

    expect(commitQueue).not.toHaveBeenCalled();
  });

  it("force-clears a locked Jam queue during an auth reset", () => {
    const { params, commitQueue } = createParams();
    const { result } = renderHook(() => usePlayerQueueStateActions(params));

    act(() => result.current.clearQueue({ force: true }));

    expect(commitQueue).toHaveBeenCalledWith([]);
  });
});
