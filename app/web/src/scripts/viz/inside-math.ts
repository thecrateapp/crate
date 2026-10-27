import {
  equalPower,
  incomingTempo,
  isDownbeat,
  lowsCut,
  mixSeconds,
  swapProgress,
  type Beat,
  type MixPlan,
} from "./mix-math";

export interface Point {
  x: number;
  y: number;
}

export interface Lane {
  top: number;
  bottom: number;
}

const f = (value: number) => value.toFixed(1);

export function columnTimes(
  start: number,
  end: number,
  from: number,
  to: number,
  width: number,
  pitch: number,
): number[] {
  const toX = (t: number) => ((t - start) / (end - start)) * width;
  const times: number[] = [];
  for (let x = Math.max(0, toX(from)); x < Math.min(width, toX(to)); x += pitch)
    times.push(start + (x / width) * (end - start));
  return times;
}

export function barsPath(
  times: readonly number[],
  levels: readonly number[],
  toX: (t: number) => number,
  lane: Lane,
  bar: number,
): string {
  const mid = (lane.top + lane.bottom) / 2;
  const half = (lane.bottom - lane.top) / 2;
  let d = "";
  times.forEach((time, i) => {
    const h = Math.max(0.5, (levels[i] ?? 0) * half);
    d += `M${f(toX(time))} ${f(mid - h)}h${bar}v${f(h * 2)}h-${bar}Z`;
  });
  return d;
}

export function ticksPath(
  beats: readonly Beat[],
  toX: (t: number) => number,
  lane: Lane,
  window: { start: number; end: number },
): { down: string; beat: string } {
  let down = "";
  let beat = "";
  const short = lane.top + (lane.bottom - lane.top) * 0.4;
  for (const { time, beat: n } of beats) {
    if (time < window.start || time > window.end) continue;
    const x = f(toX(time));
    if (isDownbeat(n)) down += `M${x} ${f(lane.top)}V${f(lane.bottom)}`;
    else beat += `M${x} ${f(short)}V${f(lane.bottom)}`;
  }
  return { down, beat };
}

export function lowsPath(
  plan: MixPlan,
  side: "out" | "in",
  from: number,
  to: number,
  toX: (t: number) => number,
  lane: Lane,
  closed = true,
  steps = 64,
): string {
  const length = mixSeconds(plan);
  const level = (t: number) =>
    1 + lowsCut(plan, t / length)[side] / Math.abs(plan.cutDb);
  let d = "";
  for (let i = 0; i <= steps; i += 1) {
    const t = from + ((to - from) * i) / steps;
    const y = lane.bottom - level(t) * (lane.bottom - lane.top);
    d += `${i ? "L" : "M"}${f(toX(t))} ${f(y)}`;
  }
  if (!closed) return d;
  return `${d}L${f(toX(to))} ${f(lane.bottom)}L${f(toX(from))} ${f(
    lane.bottom,
  )}Z`;
}

export function decibels(gain: number): string {
  if (gain < 0.001) return "−∞";
  const value = 20 * Math.log10(gain);
  const rounded = Math.round(value * 10) / 10;
  if (rounded === 0) return "0.0";
  return rounded > 0
    ? `+${rounded.toFixed(1)}`
    : `−${Math.abs(rounded).toFixed(1)}`;
}

export function tempoNudge(plan: MixPlan, time: number): string {
  const ratio = incomingTempo(plan, time) / plan.incomingBpm - 1;
  const percent = Math.round(ratio * 1000) / 10;
  if (percent === 0) return "0.0%";
  return percent > 0
    ? `+${percent.toFixed(1)}%`
    : `−${Math.abs(percent).toFixed(1)}%`;
}

export interface MixReadout {
  phase: string;
  tempo: string;
  gainA: string;
  gainB: string;
  lows: string;
}

export function mixReadout(
  plan: MixPlan,
  time: number,
  lock: number,
  looseMs: number,
  trim: number,
): MixReadout {
  const length = mixSeconds(plan);
  const gains = equalPower(time / length);
  const swap = swapProgress(plan, time / length);
  const phase =
    time < -plan.prerollS
      ? "cued"
      : lock >= 0.995
        ? "locked"
        : `${Math.round((1 - lock) * looseMs)} ms`;
  const lows = time < 0 || swap <= 0 ? "A" : swap >= 1 ? "B" : "A → B";
  return {
    phase,
    tempo: tempoNudge(plan, time),
    gainA: decibels(time < 0 ? 1 : time > length ? 0 : gains.out),
    gainB: decibels(time < 0 ? 0 : (time > length ? 1 : gains.in) * trim),
    lows,
  };
}

export function planChanges(
  pages: readonly { page: number; pages: number; lines: readonly string[] }[],
): { target: string; change: string }[] {
  const field = (lines: readonly string[], name: string) =>
    lines
      .find((line) => line.startsWith(`${name}:`))
      ?.slice(name.length + 1)
      .trim();
  return pages.flatMap((entry) => {
    const target = field(entry.lines, "targets");
    const change = field(entry.lines, "change");
    return target && change ? [{ target, change }] : [];
  });
}

export type GateStage = "idle" | "review" | "checked" | "pressed";

export function gateStage(
  index: number,
  gate: number,
  local: number,
  approveAt: number,
): GateStage {
  if (index < gate) return "idle";
  if (index > gate) return "pressed";
  if (local >= approveAt) return "pressed";
  if (local >= approveAt / 2) return "checked";
  return "review";
}

export function soundField(count: number, random: () => number): Point[] {
  return Array.from({ length: count }, () => {
    const radius = Math.sqrt(random());
    const angle = random() * Math.PI * 2;
    return { x: Math.cos(angle) * radius, y: Math.sin(angle) * radius };
  });
}

export function nearestPoints(
  points: readonly Point[],
  target: Point,
  k: number,
): number[] {
  return points
    .map((point, index) => ({
      index,
      d: Math.hypot(point.x - target.x, point.y - target.y),
    }))
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map((entry) => entry.index);
}

export function steer(target: Point, toward: Point, share: number): Point {
  return {
    x: target.x + (toward.x - target.x) * share,
    y: target.y + (toward.y - target.y) * share,
  };
}
