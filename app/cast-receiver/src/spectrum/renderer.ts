import type { ReceiverProgress } from "../receiver-store";
import type { CastSpectrumArtifact } from "./format";

const TARGET_FRAME_INTERVAL_MS = 1_000 / 15;
const BAR_GAP_RATIO = 0.36;
const MIN_BAR_HEIGHT = 2;

interface ProgressSource {
  getSnapshot(): ReceiverProgress;
}

interface PlaybackState {
  playing: boolean;
  reducedMotion: boolean;
}

interface SpectrumRendererOptions extends PlaybackState {
  artifact: CastSpectrumArtifact;
  canvas: HTMLCanvasElement;
  progress: ProgressSource;
  cancelFrame?: (handle: number) => void;
  now?: () => number;
  pixelRatio?: () => number;
  readAccent?: () => string;
  requestFrame?: (callback: FrameRequestCallback) => number;
}

export interface SpectrumRenderer {
  setPlaybackState(state: PlaybackState): void;
  start(): void;
  stop(): void;
}

function frameValue(
  artifact: CastSpectrumArtifact,
  frameIndex: number,
  bandIndex: number,
): number {
  return artifact.frames[frameIndex * artifact.bandCount + bandIndex] ?? 0;
}

export function interpolateSpectrumFrame(
  artifact: CastSpectrumArtifact,
  currentTimeSeconds: number,
): Float32Array {
  const result = new Float32Array(artifact.bandCount);
  if (artifact.frameCount === 0) return result;

  const framePosition = Math.max(
    0,
    (currentTimeSeconds * 1_000) / artifact.sampleIntervalMs,
  );
  const lowerIndex = Math.min(
    artifact.frameCount - 1,
    Math.floor(framePosition),
  );
  const upperIndex = Math.min(artifact.frameCount - 1, lowerIndex + 1);
  const ratio = Math.min(1, Math.max(0, framePosition - lowerIndex));

  for (let bandIndex = 0; bandIndex < artifact.bandCount; bandIndex += 1) {
    const lower = frameValue(artifact, lowerIndex, bandIndex);
    const upper = frameValue(artifact, upperIndex, bandIndex);
    result[bandIndex] = lower + (upper - lower) * ratio;
  }
  return result;
}

export function drawSpectrumFrame(
  context: CanvasRenderingContext2D,
  values: Float32Array,
  width: number,
  height: number,
  accent: string,
): void {
  context.clearRect(0, 0, width, height);
  if (values.length === 0 || width <= 0 || height <= 0) return;

  const slotWidth = width / values.length;
  const barWidth = Math.max(1, slotWidth * (1 - BAR_GAP_RATIO));
  context.fillStyle = accent;

  for (let index = 0; index < values.length; index += 1) {
    const normalized = Math.min(1, Math.max(0, values[index]! / 255));
    const eased = Math.sqrt(normalized);
    const barHeight = Math.min(
      height,
      Math.max(MIN_BAR_HEIGHT, eased * height),
    );
    context.globalAlpha = 0.42 + normalized * 0.58;
    context.fillRect(
      index * slotWidth + (slotWidth - barWidth) / 2,
      height - barHeight,
      barWidth,
      barHeight,
    );
  }
  context.globalAlpha = 1;
}

export function createSpectrumRenderer(
  options: SpectrumRendererOptions,
): SpectrumRenderer {
  const requestFrame = options.requestFrame ?? requestAnimationFrame;
  const cancelFrame = options.cancelFrame ?? cancelAnimationFrame;
  const now = options.now ?? (() => performance.now());
  const pixelRatio = options.pixelRatio ?? (() => window.devicePixelRatio || 1);
  const readAccent =
    options.readAccent ??
    (() =>
      getComputedStyle(options.canvas).getPropertyValue("--receiver-accent") ||
      "#10bcd4");
  let playing = options.playing;
  let reducedMotion = options.reducedMotion;
  let frameHandle: number | null = null;
  let lastPaintAt = Number.NEGATIVE_INFINITY;
  let lastObservedTime = Number.NaN;
  let anchorMediaTime = options.progress.getSnapshot().currentTime;
  let anchorTimestamp = 0;

  function draw(timestamp: number): void {
    const context = options.canvas.getContext("2d");
    if (!context) return;

    const ratio = Math.max(1, pixelRatio());
    const width = Math.max(1, options.canvas.clientWidth);
    const height = Math.max(1, options.canvas.clientHeight);
    const renderWidth = Math.round(width * ratio);
    const renderHeight = Math.round(height * ratio);
    if (
      options.canvas.width !== renderWidth ||
      options.canvas.height !== renderHeight
    ) {
      options.canvas.width = renderWidth;
      options.canvas.height = renderHeight;
    }
    context.setTransform(ratio, 0, 0, ratio, 0, 0);

    const observedTime = options.progress.getSnapshot().currentTime;
    if (
      !Number.isFinite(lastObservedTime) ||
      Math.abs(observedTime - lastObservedTime) > 0.02
    ) {
      lastObservedTime = observedTime;
      anchorMediaTime = observedTime;
      anchorTimestamp = timestamp;
    }
    const mediaTime =
      anchorMediaTime +
      (playing ? Math.max(0, timestamp - anchorTimestamp) / 1_000 : 0);
    drawSpectrumFrame(
      context,
      interpolateSpectrumFrame(options.artifact, mediaTime),
      width,
      height,
      readAccent().trim(),
    );
  }

  function schedule(): void {
    if (frameHandle !== null || !playing || reducedMotion) return;
    frameHandle = requestFrame(tick);
  }

  function tick(timestamp: number): void {
    frameHandle = null;
    if (timestamp - lastPaintAt >= TARGET_FRAME_INTERVAL_MS) {
      draw(timestamp);
      lastPaintAt = timestamp;
    }
    schedule();
  }

  function cancelScheduledFrame(): void {
    if (frameHandle === null) return;
    cancelFrame(frameHandle);
    frameHandle = null;
  }

  return {
    setPlaybackState(state: PlaybackState): void {
      const changed =
        playing !== state.playing || reducedMotion !== state.reducedMotion;
      playing = state.playing;
      reducedMotion = state.reducedMotion;
      if (!changed) return;
      if (playing && !reducedMotion) {
        schedule();
        return;
      }
      cancelScheduledFrame();
      draw(now());
    },
    start(): void {
      draw(now());
      schedule();
    },
    stop(): void {
      cancelScheduledFrame();
    },
  };
}
