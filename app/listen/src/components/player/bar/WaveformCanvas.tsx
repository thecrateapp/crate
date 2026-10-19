import {
  isMotionBlocked,
  subscribeToMotionAvailability,
} from "../../../lib/motion-availability";
import { memo, useEffect, useLayoutEffect, useRef } from "react";

import {
  drawWaveformFrame,
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

    const drawFrame = () => {
      if (cancelled) return;

      sizeRef.current = syncWaveformCanvasSize(
        canvas,
        context,
        sizeRef.current,
      );
      const sampled = readAudioFrameRef.current?.();
      const frame = drawWaveformFrame({
        cachedGradient,
        cachedGradientHeight,
        context,
        current: currentRef.current,
        frequenciesDb: sampled?.frequenciesDb ?? frequenciesDbRef.current,
        height: sizeRef.current.height,
        isPlaying,
        palette,
        peaks: peaksRef.current,
        sampleRate: sampled?.sampleRate ?? sampleRate,
        width: sizeRef.current.width,
      });
      cachedGradient = frame.gradient;
      cachedGradientHeight = frame.gradientHeight;
      if (isPlaying && !isMotionBlocked())
        rafRef.current = requestAnimationFrame(drawFrame);
    };

    const start = () => {
      cancelAnimationFrame(rafRef.current);
      if (!isMotionBlocked()) rafRef.current = requestAnimationFrame(drawFrame);
    };
    const unsubscribe = subscribeToMotionAvailability(start);
    start();

    return () => {
      cancelled = true;
      unsubscribe();
      cancelAnimationFrame(rafRef.current);
    };
  }, [isPlaying, sampleRate]);

  return <canvas ref={canvasRef} className="absolute inset-0 size-full" />;
});
