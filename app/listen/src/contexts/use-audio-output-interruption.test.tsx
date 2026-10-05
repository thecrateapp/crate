import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Track } from "@/contexts/player-types";

import { useAudioOutputInterruption } from "./use-audio-output-interruption";

const hookMocks = vi.hoisted(() => {
  const observeCleanup = vi.fn();
  const controller = {
    dispose: vi.fn(),
    hasPendingResume: vi.fn(() => false),
    install: vi.fn(),
    observe: vi.fn(() => observeCleanup),
    cancelPendingResume: vi.fn(),
  };

  return {
    controller,
    createController: vi.fn(() => controller),
    isNative: false,
    isTauriRuntime: false,
    observeCleanup,
  };
});

vi.mock("@/lib/capacitor-runtime", () => ({
  get isNative() {
    return hookMocks.isNative;
  },
}));

vi.mock("@/lib/platform", () => ({
  get isTauriRuntime() {
    return hookMocks.isTauriRuntime;
  },
}));

vi.mock("@/lib/audio-output-interruption", () => ({
  createAudioOutputInterruptionController: hookMocks.createController,
}));

vi.mock("@/lib/gapless-player", () => ({
  getAudioContext: vi.fn(() => null),
}));

function createTrack(id: string): Track {
  return { id } as Track;
}

function createInput(trackId = "track-1", isPlaying = false) {
  return {
    currentTrack: createTrack(trackId),
    isPlaying,
    isPlayingRef: { current: isPlaying },
    pause: vi.fn(),
    resume: vi.fn(),
  };
}

describe("useAudioOutputInterruption", () => {
  beforeEach(() => {
    hookMocks.isNative = false;
    hookMocks.isTauriRuntime = false;
    vi.clearAllMocks();
    hookMocks.controller.observe.mockReturnValue(hookMocks.observeCleanup);
    hookMocks.createController.mockReturnValue(hookMocks.controller);
  });

  it("installs on web and disposes listeners and observation on unmount", () => {
    const input = createInput();
    const { unmount } = renderHook(() => useAudioOutputInterruption(input));

    expect(hookMocks.createController).toHaveBeenCalledTimes(1);
    expect(hookMocks.controller.install).toHaveBeenCalledTimes(1);
    expect(hookMocks.controller.observe).toHaveBeenCalledTimes(1);

    unmount();

    expect(hookMocks.controller.dispose).toHaveBeenCalledTimes(1);
    expect(hookMocks.observeCleanup).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["Capacitor", "native"],
    ["Tauri", "tauri"],
  ])("does not install in %s runtime", (_label, runtime) => {
    hookMocks.isNative = runtime === "native";
    hookMocks.isTauriRuntime = runtime === "tauri";

    const input = createInput();
    const { unmount } = renderHook(() => useAudioOutputInterruption(input));

    expect(hookMocks.createController).not.toHaveBeenCalled();
    expect(hookMocks.controller.install).not.toHaveBeenCalled();
    unmount();
    expect(hookMocks.controller.dispose).not.toHaveBeenCalled();
  });

  it("cleans up the previous context observation before observing a new track", () => {
    const input = createInput();
    const { rerender, unmount } = renderHook(
      ({ trackId, isPlaying }: { trackId: string; isPlaying: boolean }) =>
        useAudioOutputInterruption({
          ...input,
          currentTrack: createTrack(trackId),
          isPlaying,
        }),
      { initialProps: { trackId: "track-1", isPlaying: false } },
    );

    rerender({ trackId: "track-2", isPlaying: true });

    expect(hookMocks.observeCleanup).toHaveBeenCalledTimes(1);
    expect(hookMocks.controller.observe).toHaveBeenCalledTimes(2);

    unmount();
    expect(hookMocks.observeCleanup).toHaveBeenCalledTimes(2);
  });
});
