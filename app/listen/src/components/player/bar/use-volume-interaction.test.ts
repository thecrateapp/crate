import { act, renderHook } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useVolumeInteraction } from "./use-volume-interaction";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());
function setup(canHover = true) {
  const overlay = vi.fn();
  const hook = renderHook(() => {
    const [volume, setVolume] = useState(0.65);
    return {
      volume,
      ...useVolumeInteraction({
        volume,
        onVolumeChange: setVolume,
        onOverlayChange: overlay,
        canHover,
      }),
    };
  });
  return { ...hook, overlay };
}
it("keeps hover open inside controls then closes after2500ms outside", () => {
  const { result } = setup();
  act(() => result.current.enter());
  expect(result.current.open).toBe(true);
  act(() => vi.advanceTimersByTime(5000));
  expect(result.current.open).toBe(true);
  act(() => result.current.leave());
  act(() => vi.advanceTimersByTime(2499));
  expect(result.current.open).toBe(true);
  act(() => result.current.enter());
  act(() => vi.advanceTimersByTime(5000));
  expect(result.current.open).toBe(true);
  act(() => result.current.leave());
  act(() => vi.advanceTimersByTime(2500));
  expect(result.current.open).toBe(false);
});
it("does not expire during dragging or keyboard focus", () => {
  const { result } = setup();
  act(() => {
    result.current.enter();
    result.current.setDragging(true);
    result.current.leave();
  });
  act(() => vi.advanceTimersByTime(6000));
  expect(result.current.open).toBe(true);
  act(() => {
    result.current.setDragging(false);
    result.current.setFocused(true);
  });
  act(() => vi.advanceTimersByTime(6000));
  expect(result.current.open).toBe(true);
  act(() => result.current.setFocused(false));
  act(() => vi.advanceTimersByTime(2500));
  expect(result.current.open).toBe(false);
});
it("mutes and restores the last audible controlled volume", () => {
  const { result } = setup();
  act(() => result.current.toggleMute());
  expect(result.current.volume).toBe(0);
  act(() => result.current.toggleMute());
  expect(result.current.volume).toBe(0.65);
});
it("coarse pointers do not open on hover or expire an explicit opening", () => {
  const { result } = setup(false);
  act(() => result.current.enter());
  expect(result.current.open).toBe(false);
  act(() => result.current.show());
  act(() => result.current.leave());
  act(() => vi.advanceTimersByTime(5000));
  expect(result.current.open).toBe(true);
});
it("clears idle work and overlay ownership on unmount", () => {
  const { result, unmount, overlay } = setup();
  act(() => {
    result.current.enter();
    result.current.leave();
  });
  unmount();
  expect(overlay).toHaveBeenLastCalledWith(false);
  act(() => vi.advanceTimersByTime(5000));
  expect(overlay).toHaveBeenCalledTimes(2);
});
