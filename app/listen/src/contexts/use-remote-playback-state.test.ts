import { renderHook, act } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/remote-playback-state", () => ({
  buildPlaybackStatePayload: vi.fn(
    ({ snapshotKind, queue, currentIndex, isPlaying, claimActive }) => ({
      device_id: "device",
      snapshot_kind: snapshotKind,
      status: queue.length ? (isPlaying ? "playing" : "paused") : "stopped",
      claim_active: claimActive || undefined,
      title: queue[currentIndex]?.title || "",
      artist: queue[currentIndex]?.artist || "",
      album: queue[currentIndex]?.album || "",
      position_ms: 0,
      current_index: currentIndex,
      queue_revision: `${queue.length}:${currentIndex}`,
      repeat_mode: "off",
      shuffle: false,
      playback_rate: 1,
      app_platform: "listen-web",
      device_type: "web",
    }),
  ),
  markCurrentConnectDevicePresent: vi.fn(async () => undefined),
  publishPlaybackState: vi.fn(async () => undefined),
  registerCurrentConnectDevice: vi.fn(async () => undefined),
}));

import type { AuthUser } from "@/contexts/auth-context";
import type { Track } from "@/contexts/player-types";
import {
  markCurrentConnectDevicePresent,
  publishPlaybackState,
  registerCurrentConnectDevice,
} from "@/lib/remote-playback-state";
import { useRemotePlaybackState } from "@/contexts/use-remote-playback-state";

const AUTH_USER: AuthUser = {
  id: 1,
  email: "diego@test.com",
  name: "Diego",
  role: "admin",
};

const TRACK: Track = {
  id: "track-a",
  title: "Track A",
  artist: "Artist",
};

function ref<T>(current: T) {
  return { current };
}

function makeOptions(queue: Track[] = [TRACK]) {
  return {
    authUser: AUTH_USER,
    queue,
    currentIndex: 0,
    isPlaying: false,
    shuffle: false,
    repeat: "off" as const,
    playSource: { type: "queue" as const, name: "Queue" },
    queueRef: ref(queue),
    currentIndexRef: ref(0),
    currentTimeRef: ref(0),
    durationRef: ref(0),
    isPlayingRef: ref(false),
    shuffleRef: ref(false),
    repeatRef: ref<"off" | "one" | "all">("off"),
    playSourceRef: ref({ type: "queue" as const, name: "Queue" }),
    unshuffledQueueRef: ref<Track[] | null>(null),
  };
}

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("useRemotePlaybackState", () => {
  it("registers the device and publishes structural then periodic light checkpoints", async () => {
    vi.useFakeTimers();
    renderHook(() => useRemotePlaybackState(makeOptions()));

    expect(registerCurrentConnectDevice).toHaveBeenCalledTimes(1);
    await act(async () => {
      await Promise.resolve();
    });
    expect(markCurrentConnectDevicePresent).toHaveBeenCalledTimes(1);
    act(() => {
      vi.advanceTimersByTime(16);
    });
    expect(publishPlaybackState).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot_kind: "structural" }),
      undefined,
    );

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(publishPlaybackState).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot_kind: "light" }),
      undefined,
    );

    act(() => {
      vi.advanceTimersByTime(20000);
    });

    expect(markCurrentConnectDevicePresent).toHaveBeenCalledTimes(2);
  });

  it("claims ownership only when playback explicitly transitions to playing", async () => {
    vi.useFakeTimers();
    const options = makeOptions();
    const { rerender } = renderHook(
      ({ isPlaying }) =>
        useRemotePlaybackState({
          ...options,
          isPlaying,
          isPlayingRef: ref(isPlaying),
        }),
      { initialProps: { isPlaying: false } },
    );

    await act(async () => {
      await Promise.resolve();
    });
    vi.mocked(publishPlaybackState).mockClear();

    rerender({ isPlaying: true });
    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(publishPlaybackState).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot_kind: "light",
        status: "playing",
        claim_active: true,
      }),
      undefined,
    );
    vi.mocked(publishPlaybackState).mockClear();

    act(() => {
      vi.advanceTimersByTime(10000);
    });

    expect(publishPlaybackState).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot_kind: "light",
        status: "playing",
        claim_active: undefined,
      }),
      undefined,
    );
  });

  it("suppresses the next active claim for transfer-driven playback", async () => {
    vi.useFakeTimers();
    const options = makeOptions();
    const suppressNextActiveClaimRef = ref(true);
    const { rerender } = renderHook(
      ({ isPlaying }) =>
        useRemotePlaybackState({
          ...options,
          isPlaying,
          isPlayingRef: ref(isPlaying),
          suppressNextActiveClaimRef,
        }),
      { initialProps: { isPlaying: false } },
    );

    await act(async () => {
      await Promise.resolve();
    });
    vi.mocked(publishPlaybackState).mockClear();

    rerender({ isPlaying: true });
    act(() => {
      vi.advanceTimersByTime(16);
    });

    expect(publishPlaybackState).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot_kind: "light",
        status: "playing",
        claim_active: undefined,
      }),
      undefined,
    );
    expect(suppressNextActiveClaimRef.current).toBe(false);
  });

  it("lets explicit queue resets publish a structural active claim immediately", async () => {
    const { result } = renderHook(() => useRemotePlaybackState(makeOptions()));

    await act(async () => {
      await result.current.publishStructuralNow({ claimActive: true });
    });

    expect(publishPlaybackState).toHaveBeenCalledWith(
      expect.objectContaining({
        snapshot_kind: "structural",
        claim_active: true,
      }),
    );
  });

  it("does nothing while logged out", () => {
    renderHook(() =>
      useRemotePlaybackState({ ...makeOptions(), authUser: null }),
    );

    expect(registerCurrentConnectDevice).not.toHaveBeenCalled();
    expect(markCurrentConnectDevicePresent).not.toHaveBeenCalled();
    expect(publishPlaybackState).not.toHaveBeenCalled();
  });

  it("does not register or publish while disabled", () => {
    renderHook(() =>
      useRemotePlaybackState({ ...makeOptions(), enabled: false }),
    );

    expect(registerCurrentConnectDevice).not.toHaveBeenCalled();
    expect(markCurrentConnectDevicePresent).not.toHaveBeenCalled();
    expect(publishPlaybackState).not.toHaveBeenCalled();
  });
});
