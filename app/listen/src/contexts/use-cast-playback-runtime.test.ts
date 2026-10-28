import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { CastPlaybackState } from "@/lib/cast-sender";
import { useCastPlaybackRuntime } from "./use-cast-playback-runtime";

const { subscribeMock } = vi.hoisted(() => ({
  subscribeMock: vi.fn(),
}));

vi.mock("@/lib/cast-sender", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/cast-sender")>()),
  subscribeCastPlaybackState: subscribeMock,
}));

describe("useCastPlaybackRuntime", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("commits authoritative Cast progress and playback state", () => {
    let listener: ((state: CastPlaybackState) => void) | undefined;
    const unsubscribe = vi.fn();
    subscribeMock.mockImplementation((nextListener) => {
      listener = nextListener;
      return unsubscribe;
    });
    const commitCurrentTime = vi.fn();
    const commitCurrentIndex = vi.fn();
    const commitDuration = vi.fn();
    const commitIsBuffering = vi.fn();
    const commitIsPlaying = vi.fn();
    const setVolumeState = vi.fn();

    const { result, unmount } = renderHook(() =>
      useCastPlaybackRuntime({
        commitCurrentTime,
        commitCurrentIndex,
        commitDuration,
        commitIsBuffering,
        commitIsPlaying,
        setVolumeState,
      }),
    );

    act(() => {
      listener?.({
        active: true,
        currentIndex: 3,
        currentTime: 42.5,
        duration: 185,
        isBuffering: false,
        isPlaying: true,
        volume: 0.7,
      });
    });

    expect(result.current).toBe(true);
    expect(commitCurrentTime).toHaveBeenCalledWith(42.5);
    expect(commitCurrentIndex).toHaveBeenCalledWith(3);
    expect(commitDuration).toHaveBeenCalledWith(185);
    expect(commitIsBuffering).toHaveBeenCalledWith(false);
    expect(commitIsPlaying).toHaveBeenCalledWith(true);
    expect(setVolumeState).toHaveBeenCalledWith(0.7);

    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it("ignores snapshots after the Cast session has ended", () => {
    let listener: ((state: CastPlaybackState) => void) | undefined;
    subscribeMock.mockImplementation((nextListener) => {
      listener = nextListener;
      return vi.fn();
    });
    const commitCurrentTime = vi.fn();

    const { result } = renderHook(() =>
      useCastPlaybackRuntime({
        commitCurrentTime,
        commitCurrentIndex: vi.fn(),
        commitDuration: vi.fn(),
        commitIsBuffering: vi.fn(),
        commitIsPlaying: vi.fn(),
        setVolumeState: vi.fn(),
      }),
    );

    act(() => {
      listener?.({
        active: false,
        currentTime: 0,
        duration: 0,
        isBuffering: false,
        isPlaying: false,
      });
    });

    expect(result.current).toBe(false);
    expect(commitCurrentTime).not.toHaveBeenCalled();
  });
});

it("signals EOF only once and cancels ownership when Cast disconnects", () => {
  let listener!: (state: CastPlaybackState) => void;
  subscribeMock.mockImplementation((callback) => {
    listener = callback;
    return vi.fn();
  });
  const onQueueEnded = vi.fn(() => true);
  const onResume = vi.fn();
  const onDisconnect = vi.fn();
  const commitIsBuffering = vi.fn();
  renderHook(() =>
    useCastPlaybackRuntime({
      queueRef: { current: ["last"] },
      onQueueEnded,
      onResume,
      onDisconnect,
      commitCurrentIndex: vi.fn(),
      commitCurrentTime: vi.fn(),
      commitDuration: vi.fn(),
      commitIsPlaying: vi.fn(),
      commitIsBuffering,
      setVolumeState: vi.fn(),
    }),
  );
  const state = {
    active: true,
    currentIndex: 0,
    currentTime: 50,
    duration: 100,
    isPlaying: true,
    isBuffering: false,
  };
  act(() => listener(state));
  expect(onResume).toHaveBeenCalledOnce();
  act(() => listener({ ...state, isPlaying: false }));
  expect(onQueueEnded).not.toHaveBeenCalled();
  act(() => listener(state));
  act(() => listener({ ...state, currentTime: 100, isPlaying: false }));
  act(() => listener({ ...state, currentTime: 100, isPlaying: false }));
  expect(onQueueEnded).toHaveBeenCalledOnce();
  expect(commitIsBuffering).toHaveBeenLastCalledWith(false);
  act(() => listener({ ...state, active: false }));
  expect(onDisconnect).toHaveBeenCalledOnce();
});

it("treats an external PAUSED status at the end as cancellation, not EOF", () => {
  let listener!: (state: CastPlaybackState) => void;
  subscribeMock.mockImplementation((callback) => {
    listener = callback;
    return vi.fn();
  });
  const onPause = vi.fn();
  const onQueueEnded = vi.fn(() => true);
  renderHook(() =>
    useCastPlaybackRuntime({
      queueRef: { current: ["last"] },
      onPause,
      onQueueEnded,
      commitCurrentIndex: vi.fn(),
      commitCurrentTime: vi.fn(),
      commitDuration: vi.fn(),
      commitIsPlaying: vi.fn(),
      commitIsBuffering: vi.fn(),
      setVolumeState: vi.fn(),
    }),
  );
  const state = {
    active: true,
    currentIndex: 0,
    currentTime: 100,
    duration: 100,
    isPlaying: true,
    isBuffering: false,
  };
  act(() => listener(state));
  act(() =>
    listener({
      ...state,
      isPlaying: false,
      playerState: "PAUSED",
      mediaFinished: true,
    }),
  );
  expect(onPause).toHaveBeenCalledOnce();
  expect(onQueueEnded).not.toHaveBeenCalled();
});

it("continues explicit EOF once even when the last sampled progress precedes the end", () => {
  let listener!: (state: CastPlaybackState) => void;
  subscribeMock.mockImplementation((callback) => {
    listener = callback;
    return vi.fn();
  });
  const onQueueEnded = vi.fn(() => true);
  const onPause = vi.fn();
  renderHook(() =>
    useCastPlaybackRuntime({
      queueRef: { current: ["last"] },
      onQueueEnded,
      onPause,
      commitCurrentIndex: vi.fn(),
      commitCurrentTime: vi.fn(),
      commitDuration: vi.fn(),
      commitIsPlaying: vi.fn(),
      commitIsBuffering: vi.fn(),
      setVolumeState: vi.fn(),
    }),
  );
  const state = {
    active: true,
    currentIndex: 0,
    currentTime: 98.9,
    duration: 100,
    isPlaying: true,
    isBuffering: false,
  };
  act(() => listener(state));
  const ended = {
    ...state,
    isPlaying: false,
    playerState: "IDLE",
    mediaFinished: true,
  };
  act(() => listener(ended));
  act(() => listener(ended));
  expect(onQueueEnded).toHaveBeenCalledOnce();
  expect(onPause).not.toHaveBeenCalled();
});
