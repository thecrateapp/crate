import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { useSpinningDiscPlayback } from "./use-spinning-disc-playback";

function setVisibilityState(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value,
  });
}

function createOptions() {
  return {
    currentTime: 5,
    dragRotation: null,
    duration: 180,
    isBuffering: false,
    isJogging: false,
    isPlaying: true,
  };
}

afterEach(() => {
  setVisibilityState("visible");
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useSpinningDiscPlayback", () => {
  it("pauses the animation while hidden and resumes on visibility change", () => {
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setVisibilityState("hidden");

    renderHook(() => useSpinningDiscPlayback(createOptions()));

    expect(requestAnimationFrame).not.toHaveBeenCalled();

    setVisibilityState("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });

  it("keeps its animation frame running across playback progress updates", () => {
    const requestAnimationFrame = vi.fn(() => 1);
    const cancelAnimationFrame = vi.fn();
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", cancelAnimationFrame);
    vi.spyOn(performance, "now").mockReturnValue(1000);

    const { rerender } = renderHook(
      ({ currentTime }) =>
        useSpinningDiscPlayback({ ...createOptions(), currentTime }),
      { initialProps: { currentTime: 5 } },
    );
    const scheduledFrames = requestAnimationFrame.mock.calls.length;

    rerender({ currentTime: 5.2 });

    expect(cancelAnimationFrame).not.toHaveBeenCalled();
    expect(requestAnimationFrame).toHaveBeenCalledTimes(scheduledFrames);
  });
});
