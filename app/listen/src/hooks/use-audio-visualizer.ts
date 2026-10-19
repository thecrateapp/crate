import { useCallback, useEffect, useMemo, useRef } from "react";
import { getAnalyserNode } from "@/lib/gapless-player";
import {
  isMotionBlocked,
  subscribeToMotionAvailability,
} from "@/lib/motion-availability";
const BAR_COUNT = 64;
export function createAnalyserNode(fftSize = 2048): AnalyserNode | null {
  const analyser = getAnalyserNode();
  if (!analyser) return null;
  try {
    if (analyser.fftSize !== fftSize) analyser.fftSize = fftSize;
    return analyser;
  } catch {
    return null;
  }
}
/** Stable samples. A canvas may own sampling+painting in its one frame loop (manual=true). */
export function useAudioVisualizer(
  enabled: boolean,
  trackKey?: string,
  analyserNode?: AnalyserNode | null,
  manual = false,
) {
  const analyser = useRef<AnalyserNode | null>(null),
    data = useRef<Float32Array<ArrayBuffer> | null>(null),
    wave = useRef<Uint8Array<ArrayBuffer> | null>(null);
  const samples = useRef({
    frequenciesDb: [] as number[],
    waveform: [] as number[],
    sampleRate: 44100,
  });
  const readFrame = useCallback(() => {
    if (
      analyser.current &&
      data.current &&
      wave.current &&
      !isMotionBlocked()
    ) {
      analyser.current.getFloatFrequencyData(data.current);
      analyser.current.getByteTimeDomainData(wave.current);
      for (let i = 0; i < data.current.length; i++)
        samples.current.frequenciesDb[i] = data.current[i]!;
      for (let i = 0; i < wave.current.length; i++)
        samples.current.waveform[i] = (wave.current[i]! - 128) / 128;
    }
    return samples.current;
  }, []);
  useEffect(() => {
    samples.current = { frequenciesDb: [], waveform: [], sampleRate: 44100 };
    analyser.current = null;
    data.current = null;
    wave.current = null;
    if (!enabled) return;
    const node = analyserNode || getAnalyserNode();
    if (!node) return;
    node.smoothingTimeConstant = 0.55;
    node.minDecibels = -90;
    node.maxDecibels = -10;
    analyser.current = node;
    data.current = new Float32Array(node.frequencyBinCount);
    wave.current = new Uint8Array(node.fftSize);
    samples.current.sampleRate = node.context.sampleRate || 44100;
    let raf = 0;
    const tick = () => {
      raf = 0;
      if (isMotionBlocked()) return;
      readFrame();
      raf = requestAnimationFrame(tick);
    };
    const start = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      if (!manual && !isMotionBlocked()) raf = requestAnimationFrame(tick);
    };
    const unsubscribe = subscribeToMotionAvailability(start);
    start();
    return () => {
      cancelAnimationFrame(raf);
      unsubscribe();
      analyser.current = null;
      data.current = null;
      wave.current = null;
    };
  }, [enabled, trackKey, analyserNode, manual, readFrame]);
  return useMemo(
    () => ({
      readFrame,
      barCount: BAR_COUNT,
      get frequenciesDb() {
        return samples.current.frequenciesDb;
      },
      get waveform() {
        return samples.current.waveform;
      },
      get sampleRate() {
        return samples.current.sampleRate;
      },
    }),
    [readFrame],
  );
}
