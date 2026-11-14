import { describe, expect, it, vi } from "vitest";

import {
  buildBandTargets,
  createFrameLimiter,
  drawWaveformFrame,
  getDisplayedCenters,
  isSilentSpectrum,
  WAVEFORM_FRAME_INTERVAL_MS,
  type WaveformPalette,
} from "@/components/player/bar/waveform-drawing";

const palette: WaveformPalette = {
  activeGradientBottom: "#000",
  activeGradientTop: "#fff",
  idleGradientBottom: "#000",
  idleGradientTop: "#fff",
  peakActive: "#fff",
  peakIdle: "#888",
};

function fakeContext() {
  return {
    clearRect: vi.fn(),
    fillRect: vi.fn(),
    createLinearGradient: vi.fn(() => ({ addColorStop: vi.fn() })),
    fillStyle: "",
  } as unknown as CanvasRenderingContext2D & {
    fillRect: ReturnType<typeof vi.fn>;
  };
}

function drawWith(
  frequenciesDb: number[],
  current: number[],
  peaks: number[],
  steps?: number,
) {
  return drawWaveformFrame({
    cachedGradient: null,
    cachedGradientHeight: 0,
    context: fakeContext(),
    current,
    frequenciesDb,
    height: 40,
    isPlaying: true,
    palette,
    peaks,
    sampleRate: 44100,
    steps,
    width: 240,
  });
}

describe("waveform frame cap", () => {
  it("paints every third frame on a 90 Hz panel", () => {
    const limiter = createFrameLimiter();
    const frame = 1000 / 90;
    const steps = Array.from({ length: 10 }, (_, index) =>
      limiter.next(index * frame),
    );

    expect(steps).toEqual([1, 0, 0, 3, 0, 0, 3, 0, 0, 3]);
  });

  it("paints every other frame on a 60 Hz panel despite timestamp jitter", () => {
    const limiter = createFrameLimiter();
    const timestamps = [0, 16.6, 33.2, 49.9, 66.5, 83.1];

    expect(timestamps.map((time) => limiter.next(time))).toEqual([
      1, 0, 2, 0, 2, 0,
    ]);
  });

  it("caps the paint rate near 30 fps on fast panels", () => {
    const limiter = createFrameLimiter();
    const frame = 1000 / 144;
    let paints = 0;
    for (let index = 0; index < 144; index += 1)
      if (limiter.next(index * frame) > 0) paints += 1;

    expect(paints).toBeLessThanOrEqual(31);
    expect(paints).toBeGreaterThanOrEqual(28);
    expect(WAVEFORM_FRAME_INTERVAL_MS).toBeCloseTo(1000 / 30);
  });

  it("paints immediately after a reset", () => {
    const limiter = createFrameLimiter();
    limiter.next(0);
    limiter.reset();

    expect(limiter.next(5)).toBe(1);
  });

  it("eases n steps in one paint exactly like n single-frame paints", () => {
    const loud = Array.from({ length: 1024 }, () => -30);
    const singleCurrent: number[] = [];
    const singlePeaks: number[] = [];
    for (let index = 0; index < 3; index += 1)
      drawWith(loud, singleCurrent, singlePeaks);
    const batchedCurrent: number[] = [];
    const batchedPeaks: number[] = [];
    drawWith(loud, batchedCurrent, batchedPeaks, 3);

    expect(batchedCurrent.length).toBe(singleCurrent.length);
    batchedCurrent.forEach((value, index) =>
      expect(value).toBeCloseTo(singleCurrent[index]!, 10),
    );
  });

  it("reports whether a paint left anything visible", () => {
    expect(
      drawWith(
        Array.from({ length: 1024 }, () => -30),
        [],
        [],
      ).visible,
    ).toBe(true);
    expect(
      drawWith(
        Array.from({ length: 1024 }, () => -Infinity),
        [],
        [],
      ).visible,
    ).toBe(false);
  });

  it("treats spectra below the display floor as silent", () => {
    expect(isSilentSpectrum([])).toBe(true);
    expect(isSilentSpectrum([-Infinity, -120, -90])).toBe(true);
    expect(isSilentSpectrum([-120, -60])).toBe(false);
  });
});

describe("waveform drawing math", () => {
  it("selects fewer display bands as the canvas narrows", () => {
    expect(getDisplayedCenters(640).length).toBeGreaterThan(
      getDisplayedCenters(120).length,
    );
    expect(getDisplayedCenters(120).length).toBeGreaterThan(0);
  });

  it("returns silent targets when there is no spectrum data", () => {
    const centers = getDisplayedCenters(240);

    expect(buildBandTargets([], 44100, centers)).toEqual(
      Array.from({ length: centers.length }, () => 0),
    );
  });

  it("aggregates valid spectrum data into normalized targets", () => {
    const centers = getDisplayedCenters(240).slice(0, 4);
    const targets = buildBandTargets(
      Array.from({ length: 512 }, () => -20),
      44100,
      centers,
    );

    expect(targets).toHaveLength(centers.length);
    expect(targets.every((target) => target >= 0 && target <= 1)).toBe(true);
    expect(targets.some((target) => target > 0)).toBe(true);
  });
});
