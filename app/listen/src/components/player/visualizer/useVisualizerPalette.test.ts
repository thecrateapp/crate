import { act, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { MusicVisualizer } from "./MusicVisualizer";
import type { Track } from "../../../contexts/player-types";
import { DEFAULT_PROFILE } from "./visualizer-track-profile-model";
const { extractPalette } = vi.hoisted(() => ({ extractPalette: vi.fn() }));
vi.mock("@/lib/palette", () => ({ extractPalette }));
import { useVisualizerPalette } from "./useVisualizerPalette";
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete document.documentElement.dataset.crateEffects;
});
function visualizer() {
  return {
    current: { color1: [], color2: [], color3: [], invalidateFrame: vi.fn() },
  } as unknown as { current: MusicVisualizer };
}
it("invalidates once after a delayed album palette is ready and cleans pending timers on unmount", async () => {
  vi.useFakeTimers();
  let resolvePalette!: (value: number[][]) => void;
  extractPalette.mockReturnValue(
    new Promise((resolve) => {
      resolvePalette = resolve;
    }),
  );
  const vizRef = visualizer();
  const { unmount } = renderHook(() =>
    useVisualizerPalette({
      vizRef,
      currentTrack: { id: "first", albumCover: "/first.jpg" } as Track,
      isOpen: true,
      crossfadeTransition: null,
      trackAdaptiveViz: false,
      trackVizProfile: DEFAULT_PROFILE,
      useAlbumPalette: true,
      vizEnabled: true,
    }),
  );
  expect(vizRef.current.invalidateFrame).not.toHaveBeenCalled();
  await act(async () => {
    resolvePalette([
      [0.1, 0.2, 0.3],
      [0.4, 0.5, 0.6],
      [0.7, 0.8, 0.9],
    ]);
  });
  expect(vizRef.current.invalidateFrame).toHaveBeenCalled();
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
it("settles a static crossfade palette without scheduling an animation loop", async () => {
  document.documentElement.dataset.crateEffects = "off";
  extractPalette.mockResolvedValue([
    [0.1, 0.2, 0.3],
    [0.4, 0.5, 0.6],
    [0.7, 0.8, 0.9],
  ]);
  const raf = vi.spyOn(window, "requestAnimationFrame");
  const vizRef = visualizer();
  const { unmount } = renderHook(() =>
    useVisualizerPalette({
      vizRef,
      currentTrack: undefined,
      isOpen: true,
      crossfadeTransition: {
        startedAt: performance.now(),
        durationMs: 1000,
        outgoing: { albumCover: "/old.jpg" },
        incoming: { albumCover: "/new.jpg" },
      } as never,
      trackAdaptiveViz: false,
      trackVizProfile: DEFAULT_PROFILE,
      useAlbumPalette: true,
      vizEnabled: true,
    }),
  );
  await act(async () => {
    await Promise.resolve();
  });
  expect(vizRef.current.invalidateFrame).toHaveBeenCalled();
  expect(raf).not.toHaveBeenCalled();
  unmount();
});
