import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Track } from "@/contexts/player-types";
import { cancelNativePlaybackRecoveryIntent } from "@/lib/native-playback-intent";

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
    vi.useRealTimers();
    vi.clearAllMocks();
    mocks.refreshAuthToken.mockResolvedValue(false);
    mocks.shouldUseAndroidNativePlayer.mockReturnValue(true);
  });

  it("clears a pending buffering watchdog when playback is cancelled", () => {
    vi.useFakeTimers();
    const queue = [{ id: "track-1", title: "Track" }] as Track[];
    const { result } = renderHook(() =>
      useNativeBufferingRecovery({
        beginSoftInterruption: vi.fn(),
        bufferingIntentRef: { current: false },
        commitIsBuffering: vi.fn(),
        commitIsPlaying: vi.fn(),
        currentIndexRef: { current: 0 },
        currentTimeRef: { current: 5 },
        currentTrackRef: { current: queue[0] },
        effectiveCrossfadeMsRef: { current: 0 },
        lastNonZeroVolumeRef: { current: 1 },
        queueRef: { current: queue },
        repeatRef: { current: "off" },
      }),
    );

    act(() => result.current.scheduleNativeBufferingWatchdog());
    expect(vi.getTimerCount()).toBe(1);

    act(() => cancelNativePlaybackRecoveryIntent("pause"));

    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
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

  it("does not load an autoplay queue after playback recovery is cancelled", async () => {
    const queue = [{ id: "track-1", title: "Track" }] as Track[];
    let resolveTracks!: (tracks: []) => void;
    mocks.toStartupEngineTracks.mockReturnValue(
      new Promise<[]>((resolve) => {
        resolveTracks = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useNativeBufferingRecovery({
        beginSoftInterruption: vi.fn(),
        bufferingIntentRef: { current: false },
        commitIsBuffering: vi.fn(),
        commitIsPlaying: vi.fn(),
        currentIndexRef: { current: 0 },
        currentTimeRef: { current: 5 },
        currentTrackRef: { current: queue[0] },
        effectiveCrossfadeMsRef: { current: 0 },
        lastNonZeroVolumeRef: { current: 1 },
        queueRef: { current: queue },
        repeatRef: { current: "off" },
      }),
    );

    const recovery = result.current.recoverNativeBuffering({
      forceRefresh: false,
      probeStatus: "resume-authorization",
      autoplay: true,
    });
    await waitFor(() => expect(mocks.toStartupEngineTracks).toHaveBeenCalled());

    cancelNativePlaybackRecoveryIntent();
    resolveTracks([]);

    await expect(recovery).resolves.toBe(false);
    expect(mocks.loadQueue).not.toHaveBeenCalled();
  });

  it("unlocks a cancelled recovery so the same request can retry", async () => {
    const queue = [{ id: "track-1", title: "Track" }] as Track[];
    let resolveTracks!: (tracks: []) => void;
    mocks.toStartupEngineTracks.mockReturnValueOnce(
      new Promise<[]>((resolve) => {
        resolveTracks = resolve;
      }),
    );
    const { result } = renderHook(() =>
      useNativeBufferingRecovery({
        beginSoftInterruption: vi.fn(),
        bufferingIntentRef: { current: false },
        commitIsBuffering: vi.fn(),
        commitIsPlaying: vi.fn(),
        currentIndexRef: { current: 0 },
        currentTimeRef: { current: 5 },
        currentTrackRef: { current: queue[0] },
        effectiveCrossfadeMsRef: { current: 0 },
        lastNonZeroVolumeRef: { current: 1 },
        queueRef: { current: queue },
        repeatRef: { current: "off" },
      }),
    );
    const options = {
      forceRefresh: false,
      probeStatus: "resume-authorization",
      autoplay: true,
    };

    const first = result.current.recoverNativeBuffering(options);
    await waitFor(() => expect(mocks.toStartupEngineTracks).toHaveBeenCalled());
    cancelNativePlaybackRecoveryIntent("pause");
    resolveTracks([]);
    await expect(first).resolves.toBe(false);

    mocks.toStartupEngineTracks.mockResolvedValueOnce([]);
    await expect(result.current.recoverNativeBuffering(options)).resolves.toBe(
      true,
    );
    expect(mocks.loadQueue).toHaveBeenCalledOnce();
  });

  it("uses the native resume cursor instead of stale React state", async () => {
    const queue = [
      { id: "track-1", title: "One" },
      { id: "track-2", title: "Two" },
    ] as Track[];
    mocks.toStartupEngineTracks.mockResolvedValue([]);
    const { result } = renderHook(() =>
      useNativeBufferingRecovery({
        beginSoftInterruption: vi.fn(),
        bufferingIntentRef: { current: false },
        commitIsBuffering: vi.fn(),
        commitIsPlaying: vi.fn(),
        currentIndexRef: { current: 0 },
        currentTimeRef: { current: 5 },
        currentTrackRef: { current: queue[0] },
        effectiveCrossfadeMsRef: { current: 0 },
        lastNonZeroVolumeRef: { current: 1 },
        queueRef: { current: queue },
        repeatRef: { current: "off" },
      }),
    );

    await result.current.recoverNativeBuffering({
      forceRefresh: false,
      probeStatus: "resume-authorization",
      autoplay: false,
      index: 1,
      positionMs: 23_000,
    });

    expect(mocks.toStartupEngineTracks).toHaveBeenCalledWith(
      queue,
      1,
      undefined,
      { target: "android-native" },
    );
    expect(mocks.loadQueue).toHaveBeenCalledWith(
      expect.objectContaining({
        currentIndex: 1,
        positionMs: 23_000,
        autoplay: false,
      }),
    );
  });
});
