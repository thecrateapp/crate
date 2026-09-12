import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Track } from "@/contexts/player-types";

const mocks = vi.hoisted(() => ({
  refreshAuthToken: vi.fn(),
  shouldUseAndroidNativePlayer: vi.fn(() => true),
  toStartupEngineTracks: vi.fn(),
  loadQueue: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  refreshAuthToken: mocks.refreshAuthToken,
}));

vi.mock("@/lib/android-native-engine", () => ({
  androidNativeEngine: { loadQueue: mocks.loadQueue },
  shouldUseAndroidNativePlayer: mocks.shouldUseAndroidNativePlayer,
}));

vi.mock("@/contexts/player-engine-adapter", () => ({
  toStartupEngineTracks: mocks.toStartupEngineTracks,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

import { useNativeBufferingRecovery } from "./use-native-buffering-recovery";

describe("useNativeBufferingRecovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.refreshAuthToken.mockResolvedValue(false);
    mocks.shouldUseAndroidNativePlayer.mockReturnValue(true);
  });

  it("allows the same auth recovery to retry after a failed refresh", async () => {
    const commitIsBuffering = vi.fn();
    const commitIsPlaying = vi.fn();
    const beginSoftInterruption = vi.fn();
    const queue = [{ id: "track-1", title: "Track" }] as Track[];
    const error = {
      message: "Unauthorized",
      httpStatus: 401,
      revision: "revision-1",
      trackId: "track-1",
    };
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const { result } = renderHook(() =>
      useNativeBufferingRecovery({
        beginSoftInterruption,
        bufferingIntentRef: { current: false },
        commitIsBuffering,
        commitIsPlaying,
        currentIndexRef: { current: 0 },
        currentTimeRef: { current: 5 },
        currentTrackRef: { current: queue[0] },
        effectiveCrossfadeMsRef: { current: 0 },
        lastNonZeroVolumeRef: { current: 1 },
        queueRef: { current: queue },
        repeatRef: { current: "off" },
      }),
    );

    expect(result.current.retryNativePlaybackAfterAuthError(error)).toBe(true);
    await waitFor(() =>
      expect(commitIsBuffering).toHaveBeenLastCalledWith(false),
    );

    act(() => {
      expect(result.current.retryNativePlaybackAfterAuthError(error)).toBe(
        true,
      );
    });
    await waitFor(() =>
      expect(mocks.refreshAuthToken).toHaveBeenCalledTimes(2),
    );

    consoleError.mockRestore();
  });
});
