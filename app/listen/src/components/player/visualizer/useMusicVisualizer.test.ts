import { render } from "@testing-library/react";
import { createElement, Fragment, useRef, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
  analyser,
  createAnalyserNodeMock,
  getAnalyserNodeMock,
  musicVisualizerMock,
  visualizer,
} = vi.hoisted(() => {
  const visualizer = {
    setAnalyser: vi.fn(),
    setMode: vi.fn(),
    setSize: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    destroy: vi.fn(),
  };

  return {
    analyser: {} as AnalyserNode,
    createAnalyserNodeMock: vi.fn(),
    getAnalyserNodeMock: vi.fn(),
    musicVisualizerMock: vi.fn(function MusicVisualizerMock() {
      return visualizer;
    }),
    visualizer,
  };
});

vi.mock("./MusicVisualizer", () => ({
  MusicVisualizer: musicVisualizerMock,
}));

vi.mock("@/hooks/use-audio-visualizer", () => ({
  createAnalyserNode: createAnalyserNodeMock,
}));

vi.mock("@/lib/gapless-player", () => ({
  getAnalyserNode: getAnalyserNodeMock,
}));

import { useMusicVisualizer } from "./useMusicVisualizer";

function VisualizerHarness({
  children,
  active = true,
  trackKey = "track-1",
  qualityProfile = "default",
}: {
  children?: ReactNode;
  active?: boolean;
  trackKey?: string;
  qualityProfile?: "default" | "tauri-linux";
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useMusicVisualizer(
    canvasRef,
    trackKey,
    active,
    {
      volume: 1,
      isPlaying: true,
    },
    "spheres",
    undefined,
    qualityProfile,
  );

  return createElement(
    Fragment,
    null,
    createElement("canvas", { key: qualityProfile, ref: canvasRef }),
    children,
  );
}

describe("useMusicVisualizer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    createAnalyserNodeMock.mockReturnValue(analyser);
    getAnalyserNodeMock.mockReturnValue(analyser);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("cancels delayed visualizer work when the canvas unmounts", () => {
    const { unmount } = render(createElement(VisualizerHarness));
    const canvas = document.querySelector("canvas")!;
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 180 },
    });

    vi.advanceTimersByTime(50);

    expect(musicVisualizerMock).toHaveBeenCalledTimes(1);
    expect(visualizer.start).toHaveBeenCalledTimes(1);

    unmount();

    expect(vi.getTimerCount()).toBe(0);
  });

  it("forwards the Linux Tauri quality profile to the renderer", () => {
    const { unmount } = render(
      createElement(VisualizerHarness, { qualityProfile: "tauri-linux" }),
    );
    const canvas = document.querySelector("canvas")!;
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 180 },
    });

    vi.advanceTimersByTime(50);

    expect(musicVisualizerMock).toHaveBeenCalledWith(
      canvas,
      analyser,
      expect.any(Function),
      "spheres",
      "tauri-linux",
    );

    unmount();
  });

  it("destroys the renderer once when its owner unmounts", () => {
    const { unmount } = render(createElement(VisualizerHarness));
    const canvas = document.querySelector("canvas")!;
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 180 },
    });
    vi.advanceTimersByTime(50);

    unmount();

    expect(visualizer.destroy).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps one renderer across track changes and stop/start visibility", () => {
    const { rerender, unmount } = render(createElement(VisualizerHarness));
    const canvas = document.querySelector("canvas")!;
    Object.defineProperties(canvas, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 180 },
    });
    vi.advanceTimersByTime(50);

    rerender(createElement(VisualizerHarness, { trackKey: "track-2" }));
    vi.advanceTimersByTime(50);
    rerender(createElement(VisualizerHarness, { active: false }));
    rerender(createElement(VisualizerHarness, { trackKey: "track-3" }));
    vi.advanceTimersByTime(50);

    expect(musicVisualizerMock).toHaveBeenCalledTimes(1);
    expect(visualizer.setAnalyser).toHaveBeenCalled();
    expect(visualizer.stop).toHaveBeenCalledTimes(1);
    expect(visualizer.start).toHaveBeenCalledTimes(2);

    unmount();
    expect(visualizer.destroy).toHaveBeenCalledTimes(1);
  });

  it("recreates the renderer on a fresh canvas when quality changes", () => {
    const { rerender, unmount } = render(createElement(VisualizerHarness));
    const firstCanvas = document.querySelector("canvas")!;
    Object.defineProperties(firstCanvas, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 180 },
    });
    vi.advanceTimersByTime(50);

    rerender(
      createElement(VisualizerHarness, { qualityProfile: "tauri-linux" }),
    );
    const secondCanvas = document.querySelector("canvas")!;
    Object.defineProperties(secondCanvas, {
      clientWidth: { configurable: true, value: 320 },
      clientHeight: { configurable: true, value: 180 },
    });
    vi.advanceTimersByTime(50);

    expect(firstCanvas).not.toBe(secondCanvas);
    expect(musicVisualizerMock).toHaveBeenCalledTimes(2);
    expect(visualizer.destroy).toHaveBeenCalledTimes(1);

    unmount();
    expect(visualizer.destroy).toHaveBeenCalledTimes(2);
  });
});
