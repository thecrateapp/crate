import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  isCastSessionActiveMock,
  isCustomCastSessionActiveMock,
  stopCastSessionMock,
  syncCustomCastQueueMock,
} = vi.hoisted(() => ({
  isCastSessionActiveMock: vi.fn(() => false),
  isCustomCastSessionActiveMock: vi.fn(() => false),
  stopCastSessionMock: vi.fn(),
  syncCustomCastQueueMock: vi.fn(),
}));

vi.mock("@/lib/android-native-engine", () => ({
  androidNativeEngine: { setRepeat: vi.fn() },
  shouldUseAndroidNativePlayer: () => false,
}));
vi.mock("@/lib/cast-sender", () => ({
  castStop: vi.fn(),
  isCastSessionActive: isCastSessionActiveMock,
  isCustomCastSessionActive: isCustomCastSessionActiveMock,
  stopCastSession: stopCastSessionMock,
  syncCustomCastQueue: syncCustomCastQueueMock,
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
      repeatRef: { current: "off" },
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
  beforeEach(() => {
    vi.clearAllMocks();
    isCastSessionActiveMock.mockReturnValue(false);
    isCustomCastSessionActiveMock.mockReturnValue(false);
    stopCastSessionMock.mockResolvedValue({ ok: true });
    syncCustomCastQueueMock.mockResolvedValue({ ok: true });
  });

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

  it("stops and revokes a custom Cast session when clearing the queue", () => {
    const { params } = createParams();
    params.jamQueueLockedRef.current = false;
    isCastSessionActiveMock.mockReturnValue(true);
    isCustomCastSessionActiveMock.mockReturnValue(true);
    const { result } = renderHook(() => usePlayerQueueStateActions(params));

    act(() => result.current.clearQueue());

    expect(stopCastSessionMock).toHaveBeenCalledOnce();
  });

  it("sends shuffle and repeat changes to the custom receiver", async () => {
    const { params } = createParams();
    params.jamQueueLockedRef.current = false;
    params.queueRef.current = [
      { id: "one", libraryTrackId: 1, title: "One", artist: "Artist" },
      { id: "two", libraryTrackId: 2, title: "Two", artist: "Artist" },
    ];
    params.currentIndexRef.current = 0;
    isCustomCastSessionActiveMock.mockReturnValue(true);
    params.setRepeatState = vi.fn((updater) => updater("off"));
    const { result } = renderHook(() => usePlayerQueueStateActions(params));

    act(() => {
      result.current.toggleShuffle();
      result.current.cycleRepeat();
    });

    await waitFor(() =>
      expect(syncCustomCastQueueMock).toHaveBeenCalledTimes(2),
    );
    expect(syncCustomCastQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ shuffle: true }),
    );
    expect(syncCustomCastQueueMock).toHaveBeenCalledWith(
      expect.objectContaining({ repeatMode: "all" }),
    );
  });
});
