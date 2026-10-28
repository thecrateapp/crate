import { useLayoutEffect } from "react";
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getCrossfadeAwareProgress,
  useCrossfadeProgress,
  useCrossfadeAwareProgress,
} from "./use-crossfade-progress";

describe("getCrossfadeAwareProgress", () => {
  it("returns the live playback values when there is no crossfade", () => {
    expect(getCrossfadeAwareProgress(null, 12, 240)).toEqual({
      displayedTime: 12,
      displayedDuration: 240,
    });
  });

  it("keeps the seek bar on the incoming track during a crossfade", () => {
    expect(
      getCrossfadeAwareProgress(
        {
          outgoing: {
            id: "a",
            title: "Outgoing",
            artist: "Band",
          },
          incoming: {
            id: "b",
            title: "Incoming",
            artist: "Band",
          },
          durationMs: 6000,
          startedAt: 1000,
          outgoingDurationSeconds: 321,
        },
        1.75,
        246,
      ),
    ).toEqual({
      displayedTime: 1.75,
      displayedDuration: 246,
    });
  });
});

it("drives crossfade opacity without rerendering the controller on animation frames", () => {
  const callbacks: FrameRequestCallback[] = [];
  const raf = vi
    .spyOn(window, "requestAnimationFrame")
    .mockImplementation((fn) => {
      callbacks.push(fn);
      return callbacks.length;
    });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  let renders = 0;
  const transition = {
    outgoing: { id: "a", title: "A", artist: "Band" },
    incoming: { id: "b", title: "B", artist: "Band" },
    durationMs: 1000,
    startedAt: performance.now() - 200,
    outgoingDurationSeconds: 300,
  };
  const { unmount } = renderHook(() => {
    renders++;
    return useCrossfadeProgress(transition);
  });
  const before = renders;
  act(() => {
    callbacks.shift()?.(performance.now());
  });
  expect(renders).toBe(before);
  expect(
    Number(
      document.documentElement.style.getPropertyValue(
        "--listen-crossfade-progress",
      ),
    ),
  ).toBeGreaterThan(0);
  unmount();
  raf.mockRestore();
  vi.restoreAllMocks();
});
it("does not install another crossfade clock for progress identity", () => {
  const raf = vi.spyOn(window, "requestAnimationFrame");
  const transition = {
    outgoing: { id: "a", title: "A", artist: "Band" },
    incoming: { id: "b", title: "B", artist: "Band" },
    durationMs: 1000,
    startedAt: performance.now(),
    outgoingDurationSeconds: 300,
  };
  const { unmount } = renderHook(() =>
    useCrossfadeAwareProgress(transition, 1, 300),
  );
  expect(raf).not.toHaveBeenCalled();
  unmount();
  raf.mockRestore();
});

afterEach(() => {
  vi.restoreAllMocks();
});
it("shares one animation frame among bar and expanded crossfade owners", () => {
  const raf = vi.spyOn(window, "requestAnimationFrame").mockReturnValue(47);
  const cancel = vi
    .spyOn(window, "cancelAnimationFrame")
    .mockImplementation(() => {});
  const transition = {
    outgoing: { id: "a", title: "A", artist: "Band" },
    incoming: { id: "b", title: "B", artist: "Band" },
    durationMs: 1000,
    startedAt: performance.now(),
    outgoingDurationSeconds: 300,
  };
  const first = renderHook(() => useCrossfadeProgress(transition));
  const second = renderHook(() => useCrossfadeProgress(transition));
  expect(raf).toHaveBeenCalledTimes(1);
  first.unmount();
  expect(
    document.documentElement.style.getPropertyValue(
      "--listen-crossfade-progress",
    ),
  ).not.toBe("");
  second.unmount();
  expect(cancel).toHaveBeenCalledWith(47);
  expect(
    document.documentElement.style.getPropertyValue(
      "--listen-crossfade-progress",
    ),
  ).toBe("");
});

it("initializes the real layer clock before the first paint instead of flashing incoming at full opacity", () => {
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(77);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
  const transition = {
    outgoing: { id: "a", title: "A", artist: "Band" },
    incoming: { id: "b", title: "B", artist: "Band" },
    durationMs: 1000,
    startedAt: performance.now() - 200,
    outgoingDurationSeconds: 300,
  };
  let beforePaint = "";
  const { result, unmount } = renderHook(() => {
    const fallback = useCrossfadeProgress(transition);
    useLayoutEffect(() => {
      beforePaint = document.documentElement.style.getPropertyValue(
        "--listen-crossfade-progress",
      );
    }, []);
    return fallback;
  });
  expect(Number(beforePaint)).toBeGreaterThan(0.15);
  expect(Number(beforePaint)).toBeLessThan(0.5);
  expect(result.current).toBeLessThan(0.5);
  unmount();
});
