import { act, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setUiPreferences } from "@crate/ui/lib/interface-preferences";
import {
  PATH_COVER_TRANSITION_MS,
  pathStepJump,
  peakCells,
  type PathCoverStep,
} from "./path-cover-journey-model";
import type { CoverLoader } from "./path-cover-textures";
import { PathCoverStage } from "./PathCoverStage";

const renderers = vi.hoisted(() => {
  type End = "done" | "cancelled";
  class FakeRenderer {
    static instances: FakeRenderer[] = [];
    available = true;
    progress: number | null = null;
    finish: ((end: End) => void) | null = null;
    run = vi.fn((options: { startT: number }) => {
      this.progress = options.startT;
      return new Promise<End>((resolve) => {
        this.finish = (end) => {
          this.progress = null;
          resolve(end);
        };
      });
    });
    cancel = vi.fn(() => this.finish?.("cancelled"));
    resize = vi.fn();
    dispose = vi.fn();
    constructor(
      readonly canvas: HTMLCanvasElement,
      readonly events: { onLost: () => void; onRestored: () => void },
    ) {
      FakeRenderer.instances.push(this);
    }
  }
  return FakeRenderer;
});
vi.mock("./path-cover-transition-renderer", () => ({
  PathCoverTransitionRenderer: renderers,
}));
vi.mock(import("./path-cover-textures"), async (original) => ({
  ...(await original()),
  dominantCoverColor: () => "rgb(10 20 30)",
}));

const steps: PathCoverStep[] = Array.from({ length: 6 }, (_, index) => ({
  index,
  title: `Track ${index + 1}`,
  artist: "Coast",
  coverUrl: `/covers/${index}.jpg`,
  energy: index / 10,
}));
const bitmaps = new Map<string, ImageBitmap>();
const loadCover = vi.fn(async (url: string) => {
  const bitmap = { close: vi.fn() } as unknown as ImageBitmap;
  bitmaps.set(url, bitmap);
  return bitmap;
});

async function renderStage(focus = 0, loader: CoverLoader = loadCover) {
  const view = render(
    <PathCoverStage steps={steps} focus={focus} loadCover={loader} />,
  );
  const stage = () =>
    view.container.querySelector<HTMLElement>(".path-cover-frame")!;
  const image = () =>
    view.container.querySelector<HTMLImageElement>(".path-cover-frame img");
  const move = async (next: number) => {
    view.rerender(
      <PathCoverStage steps={steps} focus={next} loadCover={loader} />,
    );
    await act(async () => {});
  };
  return { ...view, stage, image, move };
}

beforeEach(() => {
  renderers.instances = [];
  bitmaps.clear();
  loadCover.mockClear();
  vi.stubGlobal("WebGL2RenderingContext", class {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.crateMotion;
  setUiPreferences({ effects: "subtle" });
});

describe("path cover stage", () => {
  it("runs the pixelate transition between decoded covers, then rests on the HTML cover", async () => {
    const { stage, image, move, container } = await renderStage(0);
    await waitFor(() => expect(renderers.instances).toHaveLength(1));
    const renderer = renderers.instances[0]!;
    expect(container.querySelector("canvas")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    await waitFor(() =>
      expect(loadCover).toHaveBeenCalledWith("/covers/2.jpg"),
    );
    await move(1);
    expect(renderer.run).toHaveBeenCalledWith({
      from: bitmaps.get("/covers/0.jpg"),
      to: bitmaps.get("/covers/1.jpg"),
      dir: 1,
      peak: peakCells(pathStepJump(steps, 0, 1)),
      blur: 0.5,
      startT: 0,
      durationMs: PATH_COVER_TRANSITION_MS,
    });
    expect(stage()).toHaveAttribute("data-transitioning");
    expect(image()).toHaveAttribute("src", "/covers/1.jpg");
    await act(async () => renderer.finish?.("done"));
    expect(stage()).not.toHaveAttribute("data-transitioning");
  });

  it("retargets an interrupted transition from the dominant cover without restarting", async () => {
    const { move } = await renderStage(0);
    await waitFor(() => expect(renderers.instances).toHaveLength(1));
    await waitFor(() =>
      expect(loadCover).toHaveBeenCalledWith("/covers/2.jpg"),
    );
    const renderer = renderers.instances[0]!;
    await move(1);
    renderer.progress = 0.3;
    await move(2);
    expect(renderer.run).toHaveBeenLastCalledWith(
      expect.objectContaining({
        from: bitmaps.get("/covers/0.jpg"),
        to: bitmaps.get("/covers/2.jpg"),
        startT: 0.3,
        dir: 1,
        // The mosaic keeps its grain instead of snapping to the new jump.
        peak: peakCells(pathStepJump(steps, 0, 1)),
      }),
    );
  });

  it("waits for a distant cover to decode, then transitions, and tints the glow", async () => {
    const { stage, image, move, container } = await renderStage(0);
    await waitFor(() => expect(renderers.instances).toHaveLength(1));
    await waitFor(() =>
      expect(
        container
          .querySelector<HTMLElement>('[data-slot="path-cover-stage"]')!
          .style.getPropertyValue("--path-cover-glow"),
      ).toBe("rgb(10 20 30)"),
    );
    await move(5);
    expect(renderers.instances[0]!.run).toHaveBeenCalledWith(
      expect.objectContaining({
        from: bitmaps.get("/covers/0.jpg"),
        to: bitmaps.get("/covers/5.jpg"),
        peak: peakCells(pathStepJump(steps, 0, 5)),
      }),
    );
    expect(stage()).toHaveAttribute("data-transitioning");
    expect(image()).toHaveAttribute("src", "/covers/5.jpg");
  });

  it("holds the current cover briefly, then swaps when a distant cover is too slow", async () => {
    const slow = vi.fn((url: string) =>
      url === "/covers/5.jpg" ? new Promise<null>(() => {}) : loadCover(url),
    );
    const { stage, image, move } = await renderStage(0, slow);
    await waitFor(() => expect(renderers.instances).toHaveLength(1));
    await waitFor(() => expect(slow).toHaveBeenCalledWith("/covers/2.jpg"));
    await move(5);
    expect(image()).toHaveAttribute("src", "/covers/0.jpg");
    await act(() => new Promise((done) => setTimeout(done, 300)));
    expect(renderers.instances[0]!.run).not.toHaveBeenCalled();
    expect(stage()).not.toHaveAttribute("data-transitioning");
    expect(image()).toHaveAttribute("src", "/covers/5.jpg");
  });

  it("swaps instantly with motion blocked and never creates a renderer", async () => {
    document.documentElement.dataset.crateMotion = "reduced";
    const { stage, image, move, container } = await renderStage(0);
    await move(3);
    expect(renderers.instances).toHaveLength(0);
    expect(container.querySelector("canvas")).toBeNull();
    expect(stage()).not.toHaveAttribute("data-transitioning");
    expect(image()).toHaveAttribute("src", "/covers/3.jpg");
  });

  it("keeps effects off free of WebGL and glow", async () => {
    setUiPreferences({ effects: "off" });
    const { move, container } = await renderStage(0);
    await move(1);
    expect(renderers.instances).toHaveLength(0);
    expect(
      container
        .querySelector<HTMLElement>('[data-slot="path-cover-stage"]')!
        .style.getPropertyValue("--path-cover-glow"),
    ).toBe("transparent");
  });

  it("falls back after a lost context and releases the renderer on unmount", async () => {
    const { stage, move, unmount, container } = await renderStage(0);
    await waitFor(() => expect(renderers.instances).toHaveLength(1));
    await waitFor(() =>
      expect(loadCover).toHaveBeenCalledWith("/covers/2.jpg"),
    );
    const renderer = renderers.instances[0]!;
    await move(1);
    act(() => renderer.events.onLost());
    expect(stage()).not.toHaveAttribute("data-transitioning");
    await move(2);
    expect(renderer.run).toHaveBeenCalledTimes(1);
    unmount();
    expect(renderer.dispose).toHaveBeenCalled();
    expect(container.querySelector("canvas")).toBeNull();
  });
});
