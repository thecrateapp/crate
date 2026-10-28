import { mulberry32 } from "../field/sources";

export interface MixPlan {
  outgoingBpm: number;
  incomingBpm: number;
  beats: number;
  prerollS: number;
  restoreS: number;
  swapFraction: number;
  cutDb: number;
}

export interface StoryFrame {
  time: number;
  lock: number;
  stage: number;
  progress: number;
}

const LOCK_END = 0.24;
const BLEND_END = 0.76;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function equalPower(t: number): { out: number; in: number } {
  const k = clamp01(t);
  return { out: Math.cos((k * Math.PI) / 2), in: Math.sin((k * Math.PI) / 2) };
}

export function easeInOut(t: number): number {
  return (1 - Math.cos(Math.PI * clamp01(t))) / 2;
}

export function mixSeconds(plan: MixPlan): number {
  return (plan.beats * 60) / plan.outgoingBpm;
}

export function storyWindow(plan: MixPlan): { start: number; end: number } {
  return {
    start: -plan.prerollS - 1,
    end: mixSeconds(plan) + plan.restoreS + 0.5,
  };
}

export function incomingTempo(plan: MixPlan, time: number): number {
  const length = mixSeconds(plan);
  if (time < -plan.prerollS) return plan.incomingBpm;
  if (time <= length) return plan.outgoingBpm;
  const k = easeInOut((time - length) / plan.restoreS);
  return plan.outgoingBpm + (plan.incomingBpm - plan.outgoingBpm) * k;
}

export function swapProgress(plan: MixPlan, progress: number): number {
  return clamp01((progress - 0.5) / plan.swapFraction + 0.5);
}

export function lowsCut(
  plan: MixPlan,
  progress: number,
): { out: number; in: number } {
  const k = swapProgress(plan, progress);
  return { out: plan.cutDb * k, in: plan.cutDb * (1 - k) };
}

export interface Beat {
  time: number;
  beat: number;
}

export function outgoingBeats(plan: MixPlan, from: number): Beat[] {
  const interval = 60 / plan.outgoingBpm;
  const beats: Beat[] = [];
  for (let beat = Math.ceil(from / interval); beat <= plan.beats; beat += 1) {
    beats.push({ time: beat * interval, beat });
  }
  return beats;
}

export function incomingBeats(
  plan: MixPlan,
  lock: number,
  offsetS: number,
  until: number,
): Beat[] {
  const length = mixSeconds(plan);
  const first = -Math.floor((plan.prerollS * plan.outgoingBpm) / 60);
  const locked: number[] = [];
  for (let beat = first; beat <= plan.beats; beat += 1) {
    locked.push((beat * 60) / plan.outgoingBpm);
  }
  const dt = 0.002;
  let phase = 0;
  for (let time = length; time < until; ) {
    phase += (incomingTempo(plan, time) / 60) * dt;
    time += dt;
    if (phase >= 1) {
      phase -= 1;
      locked.push(time);
    }
  }
  const k = clamp01(lock);
  return locked
    .map((time, i) => {
      const beat = first + i;
      const loose = offsetS + (beat * 60) / plan.incomingBpm;
      return { time: loose + (time - loose) * k, beat };
    })
    .filter(({ time }) => time >= -plan.prerollS - 1e-6 && time <= until);
}

export const isDownbeat = (beat: number) => ((beat % 4) + 4) % 4 === 0;

export function storyAt(plan: MixPlan, p: number): StoryFrame {
  const { start, end } = storyWindow(plan);
  const length = mixSeconds(plan);
  const k = clamp01(p);
  const time =
    k < LOCK_END
      ? start - (k / LOCK_END) * start
      : k < BLEND_END
        ? ((k - LOCK_END) / (BLEND_END - LOCK_END)) * length
        : length + ((k - BLEND_END) / (1 - BLEND_END)) * (end - length);
  const lock = easeInOut((time + plan.prerollS) / (plan.prerollS * 0.8));
  const progress = time / length;
  const swapStart = 0.5 - plan.swapFraction / 2;
  const stage = time < 0 ? 0 : progress < swapStart ? 1 : progress <= 1 ? 2 : 3;
  return { time, lock, stage, progress: clamp01(progress) };
}

export function pulse(time: number, beats: number[], decay = 0.11): number {
  let last = Number.NEGATIVE_INFINITY;
  for (const beat of beats) {
    if (beat > time) break;
    last = beat;
  }
  return Number.isFinite(last) ? Math.exp(-(time - last) / decay) : 0;
}

export function waveLevels(
  times: number[],
  beats: number[],
  seed: number,
): number[] {
  const random = mulberry32(seed);
  return times.map((time) =>
    Math.min(1, 0.34 + 0.52 * pulse(time, beats) + 0.14 * random()),
  );
}
