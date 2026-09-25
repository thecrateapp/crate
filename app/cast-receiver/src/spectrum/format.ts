export const CAST_SPECTRUM_BAND_COUNT = 24;
export const CAST_SPECTRUM_INTERVAL_MS = 100;

const HEADER_BYTES = 20;
const MAX_DURATION_MS = 4 * 60 * 60 * 1_000;
const MAX_FRAME_COUNT = MAX_DURATION_MS / CAST_SPECTRUM_INTERVAL_MS;
const MAGIC = [0x43, 0x52, 0x53, 0x50] as const;

export interface CastSpectrumArtifact {
  bandCount: number;
  durationMs: number;
  frameCount: number;
  frames: Uint8Array;
  normalizationFloorDb: number;
  sampleIntervalMs: number;
  version: number;
}

function invalidSpectrum(): never {
  throw new Error("CAST_SPECTRUM_INVALID");
}

export function decodeCastSpectrum(buffer: ArrayBuffer): CastSpectrumArtifact {
  if (buffer.byteLength < HEADER_BYTES) invalidSpectrum();

  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (MAGIC.some((value, index) => bytes[index] !== value)) invalidSpectrum();

  const version = view.getUint8(4);
  const bandCount = view.getUint8(5);
  const sampleIntervalMs = view.getUint16(6);
  const frameCount = view.getUint32(8);
  const durationMs = view.getUint32(12);
  const normalizationFloorDb = view.getInt16(16);
  const reserved = view.getUint16(18);

  if (
    version !== 1 ||
    bandCount !== CAST_SPECTRUM_BAND_COUNT ||
    sampleIntervalMs !== CAST_SPECTRUM_INTERVAL_MS
  ) {
    invalidSpectrum();
  }
  if (normalizationFloorDb !== -80 || reserved !== 0) invalidSpectrum();
  if (frameCount > MAX_FRAME_COUNT || durationMs > MAX_DURATION_MS) {
    invalidSpectrum();
  }
  if (buffer.byteLength !== HEADER_BYTES + frameCount * bandCount) {
    invalidSpectrum();
  }

  return {
    bandCount,
    durationMs,
    frameCount,
    frames: new Uint8Array(buffer, HEADER_BYTES, frameCount * bandCount),
    normalizationFloorDb,
    sampleIntervalMs,
    version,
  };
}

export function spectrumFrameAt(
  artifact: CastSpectrumArtifact,
  currentTimeSeconds: number,
): Uint8Array {
  if (artifact.frameCount === 0) {
    return new Uint8Array(artifact.bandCount);
  }

  const frameIndex = Math.min(
    artifact.frameCount - 1,
    Math.max(
      0,
      Math.floor(
        (Math.max(0, currentTimeSeconds) * 1_000) / artifact.sampleIntervalMs,
      ),
    ),
  );
  const offset = frameIndex * artifact.bandCount;
  return artifact.frames.subarray(offset, offset + artifact.bandCount);
}
