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
  it("uses one compositor animation and freezes/resumes its exact phase without per-frame JS", () => {
    const rotor = document.createElement("div");
    const animations: Array<{
      currentTime: number;
      cancel: ReturnType<typeof vi.fn>;
    }> = [];
    const animate = vi.fn(() => {
      const animation = { currentTime: 0, cancel: vi.fn() };
      animations.push(animation);
      return animation;
    });
    Object.assign(rotor, { animate });
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    vi.spyOn(performance, "now").mockReturnValue(1000);
    const { result, rerender, unmount } = renderHook(
      (props: {
        currentTime: number;
        isPlaying: boolean;
        isBuffering: boolean;
      }) => {
        const controller = useSpinningDiscPlayback({
          ...createOptions(),
          ...props,
        });
        controller.rotorRef.current = rotor;
        return controller;
      },
      { initialProps: { currentTime: 5, isPlaying: true, isBuffering: false } },
    );
    expect(animate).toHaveBeenCalledOnce();
    expect(raf).not.toHaveBeenCalled();
    animations[0]!.currentTime = 1000;
    rerender({ currentTime: 5.95, isPlaying: true, isBuffering: false });
    expect(animate).toHaveBeenCalledOnce();
    expect(result.current.getRotorRotation()).toBe(720);
    rerender({ currentTime: 5.95, isPlaying: false, isBuffering: false });
    expect(animations[0]!.cancel).toHaveBeenCalledOnce();
    expect(rotor.style.transform).toContain("rotate(720deg)");
    rerender({ currentTime: 5.95, isPlaying: true, isBuffering: false });
    expect(animate).toHaveBeenCalledTimes(2);
    expect(result.current.getRotorRotation()).toBe(720);
    animations[1]!.currentTime = 1000;
    rerender({ currentTime: 6.95, isPlaying: true, isBuffering: true });
    expect(rotor.style.transform).toContain("rotate(840deg)");
    expect(animations[1]!.cancel).toHaveBeenCalledOnce();
    unmount();
    expect(raf).not.toHaveBeenCalled();
  });
  it("keeps the visible phase continuous across a coarse playback-clock correction", () => {
    const callbacks = new Map<number, FrameRequestCallback>();
    let id = 0;
    let now = 1000;
    vi.spyOn(performance, "now").mockImplementation(() => now);
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
      callbacks.set(++id, callback);
      return id;
    });
    vi.stubGlobal("cancelAnimationFrame", (frame: number) =>
      callbacks.delete(frame),
    );
    const { result, rerender } = renderHook(
      ({ currentTime }) =>
        useSpinningDiscPlayback({ ...createOptions(), currentTime }),
      { initialProps: { currentTime: 5 } },
    );
    const rotor = document.createElement("div");
    result.current.rotorRef.current = rotor;
    const tick = (timestamp: number) => {
      now = timestamp;
      const [frame, callback] = callbacks.entries().next().value!;
      callbacks.delete(frame);
      act(() => callback(timestamp));
      return Number(rotor.style.transform.match(/rotate\(([-\d.]+)deg\)/)![1]);
    };
    tick(1100);
    const before = tick(1200);
    rerender({ currentTime: 5.95 });
    const after = tick(1216);
    expect(after - before).toBeCloseTo(1.92, 2);
  });
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

  it("uses the latest playback time when motion resumes", () => {
    const requestAnimationFrame = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", requestAnimationFrame);
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    setVisibilityState("hidden");

    const rotor = document.createElement("div");
    const { result, rerender } = renderHook(
      ({ currentTime }) =>
        useSpinningDiscPlayback({ ...createOptions(), currentTime }),
      { initialProps: { currentTime: 5 } },
    );
    result.current.rotorRef.current = rotor;

    rerender({ currentTime: 12 });

    setVisibilityState("visible");
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(rotor.style.transform).toContain("rotate(1440deg)");
    expect(requestAnimationFrame).toHaveBeenCalledOnce();
  });
});
