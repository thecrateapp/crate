import {
  isMotionBlocked,
  subscribeToMotionAvailability,
} from "../../../lib/motion-availability";
import { memo, useEffect, useLayoutEffect, useRef } from "react";

import {
  createFrameLimiter,
  drawWaveformFrame,
  isSilentSpectrum,
  readWaveformPalette,
  syncWaveformCanvasSize,
} from "./waveform-drawing";

interface WaveformCanvasProps {
  readAudioFrame?: () => { frequenciesDb: number[]; sampleRate: number };
  frequenciesDb: number[];
  sampleRate: number;
  isPlaying: boolean;
}

export const WaveformCanvas = memo(function WaveformCanvas({
  frequenciesDb,
  readAudioFrame,
  sampleRate,
  isPlaying,
}: WaveformCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readAudioFrameRef = useRef(readAudioFrame);
  readAudioFrameRef.current = readAudioFrame;
  const frequenciesDbRef = useRef(frequenciesDb);
  const currentRef = useRef<number[]>([]);
  const peaksRef = useRef<number[]>([]);
  const rafRef = useRef<number>(0);
  const sizeRef = useRef({ width: 0, height: 0, dpr: 1 });
  useLayoutEffect(() => {
    frequenciesDbRef.current = frequenciesDb;
  }, [frequenciesDb]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let cancelled = false;
    const context = canvas.getContext("2d");
    if (!context) return;

    const palette = readWaveformPalette(canvas);
    let cachedGradient: CanvasGradient | null = null;
    let cachedGradientHeight = 0;
    // Painting at the panel's refresh rate (90-144 Hz) re-rasterised the
    // masked, blurred player shell every frame; ~30 fps reads the same.
    const limiter = createFrameLimiter();
    let lastPaintVisible = true;

    // Measure through ResizeObserver so the loop never forces layout.
    let measured: { width: number; height: number } | undefined;
    let resizeObserver: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      measured = { width: canvas.clientWidth, height: canvas.clientHeight };
      resizeObserver = new ResizeObserver(() => {
        measured = { width: canvas.clientWidth, height: canvas.clientHeight };
      });
      resizeObserver.observe(canvas);
    }

    const schedule = () => {
      if (isPlaying && !isMotionBlocked())
        rafRef.current = requestAnimationFrame(drawFrame);
    };

    function drawFrame(timestamp: number) {
      if (cancelled) return;
      const steps = limiter.next(timestamp);
      if (steps === 0) {
        schedule();
        return;
      }

      const sampled = readAudioFrameRef.current?.();
      const frameDb = sampled?.frequenciesDb ?? frequenciesDbRef.current;
      // Silence after the bars have fallen: the canvas is already empty.
      if (isPlaying && !lastPaintVisible && isSilentSpectrum(frameDb)) {
        schedule();
        return;
      }

      sizeRef.current = syncWaveformCanvasSize(
        canvas!,
        context!,
        sizeRef.current,
        measured,
      );
      const frame = drawWaveformFrame({
        cachedGradient,
        cachedGradientHeight,
        context: context!,
        current: currentRef.current,
        frequenciesDb: frameDb,
        height: sizeRef.current.height,
        isPlaying,
        palette,
        peaks: peaksRef.current,
        sampleRate: sampled?.sampleRate ?? sampleRate,
        steps,
        width: sizeRef.current.width,
      });
      cachedGradient = frame.gradient;
      cachedGradientHeight = frame.gradientHeight;
      lastPaintVisible = frame.visible;
      schedule();
    }

    const start = () => {
      cancelAnimationFrame(rafRef.current);
      limiter.reset();
      lastPaintVisible = true;
      if (!isMotionBlocked()) rafRef.current = requestAnimationFrame(drawFrame);
    };
    const unsubscribe = subscribeToMotionAvailability(start);
    start();

    return () => {
      cancelled = true;
      unsubscribe();
      resizeObserver?.disconnect();
      cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, sampleRate]);

  // will-change gives the canvas its own compositing layer, so a repaint does
  // not re-rasterise the masked wrapper and the blurred shell around it.
  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0 size-full will-change-transform"
    />
  );
});
