import { MIX } from "../../content/listen/viz";
import {
  columnTimes,
  barsPath,
  lowsPath,
  ticksPath,
  type Lane,
} from "./inside-math";
import {
  equalPower,
  incomingBeats,
  mixSeconds,
  outgoingBeats,
  storyWindow,
  waveLevels,
  type MixPlan,
} from "./mix-math";

export const PLAN: MixPlan = {
  outgoingBpm: MIX.a.bpm,
  incomingBpm: MIX.b.bpm,
  beats: MIX.beats,
  prerollS: MIX.prerollMs / 1000,
  restoreS: MIX.tempoRestoreMs / 1000,
  swapFraction: MIX.bass.swapFraction,
  cutDb: MIX.bass.cutDb,
};
export const LENGTH = mixSeconds(PLAN);
export const WINDOW = storyWindow(PLAN);
export const TRIM = 10 ** ((MIX.a.lufs - MIX.b.lufs) / 20);
export const VIEW = { width: 600, height: 240 };

const PITCH = 4;
const BAR = 2.2;

export const LANES = {
  aWave: { top: 16, bottom: 82 },
  aGrid: { top: 88, bottom: 102 },
  bGrid: { top: 106, bottom: 120 },
  bWave: { top: 126, bottom: 192 },
  lows: { top: 210, bottom: 238 },
} satisfies Record<string, Lane>;

export const toX = (t: number) =>
  ((t - WINDOW.start) / (WINDOW.end - WINDOW.start)) * VIEW.width;

const columns = (from: number, to: number) =>
  columnTimes(WINDOW.start, WINDOW.end, from, to, VIEW.width, PITCH);

const aBeats = outgoingBeats(PLAN, WINDOW.start);
export const A_TIMES = aBeats.map((beat) => beat.time);

export function outgoing() {
  const times = columns(WINDOW.start, LENGTH);
  const levels = waveLevels(times, A_TIMES, 4).map(
    (level, i) => level * equalPower(times[i]! / LENGTH).out,
  );
  return {
    wave: barsPath(times, levels, toX, LANES.aWave, BAR),
    ticks: ticksPath(aBeats, toX, LANES.aGrid, WINDOW),
  };
}

export function incoming(lock: number) {
  const beats = incomingBeats(
    PLAN,
    lock,
    MIX.b.looseOffsetMs / 1000,
    WINDOW.end,
  );
  const times = beats.map((beat) => beat.time);
  const muted = columns(-PLAN.prerollS, 0);
  const live = columns(0, WINDOW.end);
  const levels = waveLevels(live, times, 11).map(
    (level, i) => level * TRIM * equalPower(live[i]! / LENGTH).in,
  );
  return {
    muted: barsPath(muted, waveLevels(muted, times, 9), toX, LANES.bWave, BAR),
    wave: barsPath(live, levels, toX, LANES.bWave, BAR),
    ticks: ticksPath(beats, toX, LANES.bGrid, WINDOW),
  };
}

export function lows() {
  const a = [PLAN, "out", WINDOW.start, LENGTH, toX, LANES.lows] as const;
  const b = [PLAN, "in", 0, WINDOW.end, toX, LANES.lows] as const;
  return {
    a: lowsPath(...a),
    b: lowsPath(...b),
    aLine: lowsPath(...a, false),
    bLine: lowsPath(...b, false),
  };
}

export function spans() {
  const swapFrom = LENGTH * (0.5 - PLAN.swapFraction / 2);
  return [
    [-PLAN.prerollS, 0],
    [0, swapFrom],
    [swapFrom, LENGTH],
    [LENGTH, LENGTH + PLAN.restoreS],
  ].map(([from, to]) => ({
    from: toX(from!) / VIEW.width,
    to: toX(to!) / VIEW.width,
  }));
}
