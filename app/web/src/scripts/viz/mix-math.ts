import { mulberry32 } from "../field/sources";

export function equalPower(t: number): { out: number; in: number } {
  const k = Math.min(1, Math.max(0, t));
  return { out: Math.cos((k * Math.PI) / 2), in: Math.sin((k * Math.PI) / 2) };
}

export function beatTimes(bpm: number, seconds: number, offset = 0): number[] {
  const interval = 60 / bpm;
  const times: number[] = [];
  for (let time = offset; time <= seconds + 1e-9; time += interval) {
    times.push(Number(time.toFixed(4)));
  }
  return times;
}

export interface EnvelopeShape {
  bars: number;
  seed: number;
  rampIn?: number;
  rampOut?: number;
  beatsPerBar?: number;
}

export function waveform({
  bars,
  seed,
  rampIn = 0,
  rampOut = 1,
  beatsPerBar = 4,
}: EnvelopeShape): number[] {
  const random = mulberry32(seed);
  const values: number[] = [];
  let drift = 0.6;
  for (let i = 0; i < bars; i += 1) {
    const t = i / Math.max(1, bars - 1);
    drift += (random() - 0.5) * 0.12;
    drift = Math.min(0.85, Math.max(0.45, drift));
    const beat = i % beatsPerBar === 0 ? 0.22 : i % 2 === 0 ? 0.08 : 0;
    let level = drift + beat + (random() - 0.5) * 0.16;
    if (t < rampIn) level *= 0.18 + 0.82 * (t / rampIn) ** 1.6;
    if (t > rampOut) level *= 0.12 + 0.88 * ((1 - t) / (1 - rampOut)) ** 1.4;
    values.push(Math.min(1, Math.max(0.04, level)));
  }
  return values;
}
