import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EngineMixState } from "@/lib/playback-engine";
import type {
  PlayerActionsValue,
  PlayerProgressValue,
  PlayerStateValue,
} from "@/contexts/player-context";

import { usePlayerContextValues } from "./use-player-context-values";

function createInput() {
  const state: PlayerStateValue = {
    analyserVersion: 1,
    crossfadeTransition: null,
    isBuffering: false,
    isPlaying: true,
    volume: 0.8,
  };
  const progress: PlayerProgressValue = { currentTime: 12, duration: 180 };
  const actions = {
    addToQueue: vi.fn(),
    captureQueueSnapshot: vi.fn(),
    clearQueue: vi.fn(),
    connect: { enabled: false },
    currentIndex: 0,
    currentTrack: undefined,
    cycleRepeat: vi.fn(),
    enterJamSession: vi.fn(),
    jamQueueLocked: false,
    jamTransport: null,
    jumpTo: vi.fn(),
    leaveJamSession: vi.fn(),
    next: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(),
    playAll: vi.fn(),
    playNext: vi.fn(),
    playSource: null,
    prev: vi.fn(),
    publishConnectState: vi.fn(),
    queue: [],
    reorderQueue: vi.fn(),
    removeFromQueue: vi.fn(),
    repeat: "off",
    restoreQueueSnapshot: vi.fn(),
    recentlyPlayed: [],
    resume: vi.fn(),
    seek: vi.fn(),
    setJamTransport: vi.fn(),
    setPlaybackRate: vi.fn(),
    setVolume: vi.fn(),
    shuffle: false,
    smartCrossfadeEnabled: false,
    syncJamQueue: vi.fn(),
    toggleShuffle: vi.fn(),
  } as unknown as PlayerActionsValue;

  return { actions, progress, state };
}

describe("usePlayerContextValues", () => {
  it("publishes actual mix changes only in state, independently of progress ticks", () => {
    const input = createInput();
    const mixState: EngineMixState = {
      revision: "queue-a",
      executionId: 1,
      mode: "beatmatch",
      phase: "mixing",
      bassHandoff: true,
    };
    const { result, rerender } = renderHook(usePlayerContextValues, {
      initialProps: input,
    });
    const initial = result.current;
    rerender({
      ...input,
      state: { ...input.state, mixState, nativeMixAvailable: true },
    });
    expect(result.current.stateValue).toMatchObject({
      mixState,
      nativeMixAvailable: true,
    });
    expect(result.current.actionsValue).toBe(initial.actionsValue);
    const mixed = result.current.stateValue;
    rerender({
      ...input,
      state: { ...input.state, mixState, nativeMixAvailable: true },
      progress: { ...input.progress, currentTime: 13 },
    });
    expect(result.current.stateValue).toBe(mixed);
    rerender({
      ...input,
      state: { ...input.state, mixState: null, nativeMixAvailable: false },
    });
    expect(result.current.stateValue).toMatchObject({
      mixState: null,
      nativeMixAvailable: false,
    });
  });

  it("keeps context value references stable until a dependency changes", () => {
    const input = createInput();
    const { result, rerender } = renderHook(
      ({ actions, progress, state }) =>
        usePlayerContextValues({ actions, progress, state }),
      { initialProps: input },
    );
    const initial = result.current;

    rerender({
      actions: { ...input.actions },
      progress: { ...input.progress },
      state: { ...input.state },
    });

    expect(result.current).toEqual(initial);
    expect(result.current.stateValue).toBe(initial.stateValue);
    expect(result.current.progressValue).toBe(initial.progressValue);
    expect(result.current.actionsValue).toBe(initial.actionsValue);

    rerender({
      actions: { ...input.actions, currentIndex: 1 },
      progress: { ...input.progress },
      state: { ...input.state },
    });

    expect(result.current.actionsValue).not.toBe(initial.actionsValue);
    expect(result.current.stateValue).toBe(initial.stateValue);
    expect(result.current.progressValue).toBe(initial.progressValue);
  });
});
