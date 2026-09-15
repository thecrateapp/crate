import { describe, expect, it, vi } from "vitest";

import type { ReceiverProgress } from "../receiver-store";
import type { CastSpectrumArtifact } from "./format";
import {
  createSpectrumRenderer,
  drawSpectrumFrame,
  interpolateSpectrumFrame,
} from "./renderer";

function artifact(): CastSpectrumArtifact {
  return {
    version: 1,
    bandCount: 24,
    frameCount: 2,
    sampleIntervalMs: 100,
    durationMs: 200,
    normalizationFloorDb: -80,
    frames: new Uint8Array([...Array(24).fill(0), ...Array(24).fill(200)]),
  };
}

describe("Cast spectrum renderer", () => {
  it("interpolates adjacent frames and clamps media time", () => {
    const decoded = artifact();

    expect([...interpolateSpectrumFrame(decoded, -1)]).toEqual(
      Array(24).fill(0),
    );
    expect([...interpolateSpectrumFrame(decoded, 0.05)]).toEqual(
      Array(24).fill(100),
    );
    expect([...interpolateSpectrumFrame(decoded, 99)]).toEqual(
      Array(24).fill(200),
    );
  });

  it("draws one bounded bar per frequency band", () => {
    const fillRect = vi.fn();
    const context = {
      clearRect: vi.fn(),
      fillRect,
      fillStyle: "",
      globalAlpha: 1,
    } as unknown as CanvasRenderingContext2D;

    drawSpectrumFrame(
      context,
      new Float32Array(24).fill(255),
      480,
      120,
      "#0cf",
    );

    expect(context.clearRect).toHaveBeenCalledWith(0, 0, 480, 120);
    expect(fillRect).toHaveBeenCalledTimes(24);
    for (const [, y, , height] of fillRect.mock.calls) {
      expect(y).toBeGreaterThanOrEqual(0);
      expect(height).toBeLessThanOrEqual(120);
    }
  });

  it("animates only while playing and renders a stable paused frame", () => {
    let progress: ReceiverProgress = { currentTime: 0, duration: 1 };
    const progressSource = { getSnapshot: () => progress };
    const callbacks = new Map<number, FrameRequestCallback>();
    let nextFrameId = 1;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => {
      const id = nextFrameId++;
      callbacks.set(id, callback);
      return id;
    });
    const cancelFrame = vi.fn((id: number) => callbacks.delete(id));
    const fillRect = vi.fn();
    const context = {
      clearRect: vi.fn(),
      fillRect,
      fillStyle: "",
      globalAlpha: 1,
      setTransform: vi.fn(),
    } as unknown as CanvasRenderingContext2D;
    const canvas = {
      clientHeight: 120,
      clientWidth: 480,
      getContext: () => context,
      height: 0,
      width: 0,
    } as unknown as HTMLCanvasElement;
    const renderer = createSpectrumRenderer({
      artifact: artifact(),
      canvas,
      progress: progressSource,
      playing: true,
      reducedMotion: false,
      requestFrame,
      cancelFrame,
      pixelRatio: () => 1,
      readAccent: () => "#0cf",
      now: () => 200,
    });

    renderer.start();
    callbacks.get(1)?.(0);
    progress = { currentTime: 0.1, duration: 1 };
    callbacks.get(2)?.(100);
    const animatedDrawCount = fillRect.mock.calls.length;

    expect(animatedDrawCount).toBeGreaterThan(24);
    renderer.setPlaybackState({ playing: false, reducedMotion: false });
    expect(cancelFrame).toHaveBeenCalled();
    expect(fillRect.mock.calls.length).toBe(animatedDrawCount + 24);

    renderer.setPlaybackState({ playing: true, reducedMotion: true });
    expect(requestFrame).toHaveBeenCalledTimes(3);
    renderer.stop();
  });
});
