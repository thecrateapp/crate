import { describe, expect, it } from "vitest";

import {
  CAST_SPECTRUM_BAND_COUNT,
  CAST_SPECTRUM_INTERVAL_MS,
  decodeCastSpectrum,
  spectrumFrameAt,
} from "./format";

function envelope(
  frames: number[][],
  overrides: {
    bandCount?: number;
    durationMs?: number;
    intervalMs?: number;
    normalizationFloorDb?: number;
    reserved?: number;
    version?: number;
  } = {},
): ArrayBuffer {
  const bandCount = overrides.bandCount ?? CAST_SPECTRUM_BAND_COUNT;
  const buffer = new ArrayBuffer(20 + frames.length * bandCount);
  const bytes = new Uint8Array(buffer);
  bytes.set([0x43, 0x52, 0x53, 0x50]);
  const view = new DataView(buffer);
  view.setUint8(4, overrides.version ?? 1);
  view.setUint8(5, bandCount);
  view.setUint16(6, overrides.intervalMs ?? CAST_SPECTRUM_INTERVAL_MS);
  view.setUint32(8, frames.length);
  view.setUint32(
    12,
    overrides.durationMs ?? frames.length * CAST_SPECTRUM_INTERVAL_MS,
  );
  view.setInt16(16, overrides.normalizationFloorDb ?? -80);
  view.setUint16(18, overrides.reserved ?? 0);
  bytes.set(frames.flat(), 20);
  return buffer;
}

describe("Cast spectrum format", () => {
  it("decodes the versioned 24-band envelope without copying frame data", () => {
    const first = Array.from({ length: CAST_SPECTRUM_BAND_COUNT }, (_, i) => i);
    const second = first.map((value) => value + 24);

    const artifact = decodeCastSpectrum(envelope([first, second]));

    expect(artifact).toMatchObject({
      version: 1,
      bandCount: 24,
      frameCount: 2,
      sampleIntervalMs: 100,
      durationMs: 200,
      normalizationFloorDb: -80,
    });
    expect([...artifact.frames]).toEqual([...first, ...second]);
  });

  it.each([
    ["magic", () => new ArrayBuffer(20)],
    ["version", () => envelope([], { version: 2 })],
    ["bands", () => envelope([], { bandCount: 12 })],
    ["interval", () => envelope([], { intervalMs: 50 })],
    ["normalization", () => envelope([], { normalizationFloorDb: -60 })],
    ["reserved", () => envelope([], { reserved: 1 })],
    [
      "truncated",
      () => envelope([Array(CAST_SPECTRUM_BAND_COUNT).fill(1)]).slice(0, -1),
    ],
  ])("rejects an invalid %s contract", (_name, makePayload) => {
    expect(() => decodeCastSpectrum(makePayload())).toThrow(
      "CAST_SPECTRUM_INVALID",
    );
  });

  it("maps media time to a bounded frame view", () => {
    const frames = [
      Array(CAST_SPECTRUM_BAND_COUNT).fill(10),
      Array(CAST_SPECTRUM_BAND_COUNT).fill(20),
    ];
    const artifact = decodeCastSpectrum(envelope(frames));

    expect([...spectrumFrameAt(artifact, -1)]).toEqual(frames[0]);
    expect([...spectrumFrameAt(artifact, 0.11)]).toEqual(frames[1]);
    expect([...spectrumFrameAt(artifact, 99)]).toEqual(frames[1]);
  });
});
