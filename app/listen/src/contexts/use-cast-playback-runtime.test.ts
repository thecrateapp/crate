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
    const commitDuration = vi.fn();
    const commitIsBuffering = vi.fn();
    const commitIsPlaying = vi.fn();
    const setVolumeState = vi.fn();

    const { unmount } = renderHook(() =>
      useCastPlaybackRuntime({
        commitCurrentTime,
        commitDuration,
        commitIsBuffering,
        commitIsPlaying,
        setVolumeState,
      }),
    );

    act(() => {
      listener?.({
        active: true,
        currentTime: 42.5,
        duration: 185,
        isBuffering: false,
        isPlaying: true,
        volume: 0.7,
      });
    });

    expect(commitCurrentTime).toHaveBeenCalledWith(42.5);
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

    renderHook(() =>
      useCastPlaybackRuntime({
        commitCurrentTime,
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

    expect(commitCurrentTime).not.toHaveBeenCalled();
  });
});
