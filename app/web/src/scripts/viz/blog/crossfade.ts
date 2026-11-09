import { barsPath, columnTimes, ticksPath, type Lane } from "../inside-math";
import { waveLevels, type Beat } from "../mix-math";
import type { PhaseTrack } from "./phase-clock";

/**
 * H19 figure: one transition under three Android mechanisms. The gain curves
 * follow NativeMixController before e08714d4 (timer, constant staging, unity at
 * the end) and NativeMixAudioProcessor after it (equal power with eased
 * staging). The six-second fade, the UI stall, the staging level and the start
 * offset of separate outputs are illustrative.
 */

export type CrossfadeState = "timer" | "pcm" | "bus";

export const FADE = 6;
export const WINDOW = { start: -1.6, end: 6.8 };
export const VIEW = { width: 600, height: 250 };
export const STALL = { from: 2, to: 3.4 };
export const STAGING_DB = -3;
export const STAGING = 10 ** (STAGING_DB / 20);
const BEAT = 60 / 124;
const START_OFFSET = 0.12;
const LEAD = -WINDOW.start;

export const LANES = {
  aWave: { top: 10, bottom: 66 },
  aGrid: { top: 72, bottom: 84 },
  bGrid: { top: 88, bottom: 100 },
  bWave: { top: 106, bottom: 162 },
  ui: { top: 174, bottom: 182 },
  gain: { top: 194, bottom: 246 },
} satisfies Record<string, Lane>;

export const CROSSFADE_STATES = [
  {
    id: "timer",
    label: "UI timer",
    phases: [
      {
        title: "Timer",
        body: "The main thread sets both deck volumes every 20 ms.",
      },
      {
        title: "UI busy",
        body: "Samples keep playing while the next volume update waits. Both gains hold.",
      },
      {
        title: "Catch up",
        body: "The callback resumes at a later point in the fade, so both gains jump.",
      },
      {
        title: "Unity",
        body: "The incoming staging was held for the whole fade. At the end it steps up about 3 dB.",
      },
    ],
  },
  {
    id: "pcm",
    label: "PCM envelope",
    phases: [
      {
        title: "Per sample",
        body: "Each deck's audio processor computes its gain frame by frame.",
      },
      {
        title: "UI busy",
        body: "The stall no longer reaches the fade. Gain follows the samples.",
      },
      {
        title: "Ease staging",
        body: "After the midpoint, incoming staging eases back to unity. Nothing jumps at the end.",
      },
    ],
  },
  {
    id: "bus",
    label: "Shared bus",
    phases: [
      {
        title: "Hold B",
        body: "B writes PCM into a ring buffer and waits for a frame on the shared bus.",
      },
      {
        title: "Start on a frame",
        body: "The mixer starts consuming B at the planned frame, so its beats meet A's.",
      },
      {
        title: "One output",
        body: "A 48 kHz mixer sums both decks and writes one `AudioTrack`.",
      },
    ],
  },
] as const satisfies readonly {
  id: CrossfadeState;
  label: string;
  phases: readonly { title: string; body: string }[];
}[];

const at = (s: number) => s + LEAD;

export const CROSSFADE_TRACKS: Record<CrossfadeState, PhaseTrack> = {
  timer: {
    period: 10,
    starts: [0, at(STALL.from), at(STALL.to), at(FADE - 0.4)],
    pins: [at(1.4), at(3.1), at(4.2), at(6.4)],
  },
  pcm: {
    period: 10,
    starts: [0, at(STALL.from), at(STALL.to)],
    pins: [at(1.4), at(3.1), at(6.4)],
  },
  bus: {
    period: 10,
    starts: [0, at(0), at(3)],
    pins: [at(-0.5), at(1.2), at(6.4)],
  },
};

/** Transition time at a figure time: lead-in, the fade, then a hold at the end. */
export function storyTime(t: number): number {
  return Math.min(t - LEAD, WINDOW.end);
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const easeIn = (p: number) =>
  p >= 0.5 ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * p) / 0.5);
const easeOut = (p: number) =>
  p <= 0.5 ? 1 : 0.5 + 0.5 * Math.cos((Math.PI * (p - 0.5)) / 0.5);
const staging = (gain: number, weight: number) => 1 + (gain - 1) * weight;

export function gains(
  state: CrossfadeState,
  s: number,
): { a: number; b: number } {
  if (s < 0) return { a: 1, b: 0 };
  if (s >= FADE) return { a: 0, b: 1 };
  if (state === "timer") {
    const applied = s >= STALL.from && s < STALL.to ? STALL.from : s;
    const p = clamp01(applied / FADE);
    return {
      a: Math.cos((p * Math.PI) / 2),
      b: Math.sin((p * Math.PI) / 2) * STAGING,
    };
  }
  const p = clamp01(s / FADE);
  return {
    a: Math.cos((p * Math.PI) / 2) * staging(1, easeIn(p)),
    b: Math.sin((p * Math.PI) / 2) * staging(STAGING, easeOut(p)),
  };
}

export const beatOffset = (state: CrossfadeState) =>
  state === "bus" ? 0 : START_OFFSET;

type Tone = "warn" | "ok" | undefined;

const db = (gain: number) =>
  gain < 0.001 ? "off" : (20 * Math.log10(gain)).toFixed(1);

export function crossfadeReadout(state: CrossfadeState, s: number) {
  const { a, b } = gains(state, s);
  const busy = state !== "bus" && s >= STALL.from && s < STALL.to;
  return {
    gainA: db(a),
    gainB: db(b),
    ui: busy
      ? { text: "Busy", tone: "warn" as Tone }
      : { text: "Idle", tone: undefined as Tone },
    beats:
      state === "bus"
        ? { text: "Aligned", tone: "ok" as Tone }
        : { text: "Not aligned", tone: "warn" as Tone },
    output: state === "bus" ? "1 bus" : "2 players",
  };
}

export const toX = (s: number) =>
  ((s - WINDOW.start) / (WINDOW.end - WINDOW.start)) * VIEW.width;

function beats(from: number, offset: number): Beat[] {
  const list: Beat[] = [];
  for (
    let k = Math.ceil((from - offset) / BEAT);
    offset + k * BEAT <= WINDOW.end;
    k++
  )
    list.push({ time: offset + k * BEAT, beat: k });
  return list;
}

const columns = (from: number, to: number) =>
  columnTimes(WINDOW.start, WINDOW.end, from, to, VIEW.width, 4);

function curve(
  state: CrossfadeState,
  deck: "a" | "b",
  lane: Lane,
  planned = false,
) {
  let d = "";
  for (let s = WINDOW.start; s <= WINDOW.end + 1e-9; s += 0.02) {
    const g =
      planned && state === "timer"
        ? gains("pcm", s)[deck]
        : gains(state, s)[deck];
    const y = lane.bottom - g * (lane.bottom - lane.top);
    d += `${d ? "L" : "M"}${toX(s).toFixed(1)} ${y.toFixed(1)}`;
  }
  return d;
}

/** Static geometry for one state, rendered on the server. */
export function scenePaths(state: CrossfadeState) {
  const offset = beatOffset(state);
  const aBeats = beats(WINDOW.start, 0);
  const bBeats = beats(offset, offset);
  const aTimes = columns(WINDOW.start, FADE);
  const bTimes = columns(offset, WINDOW.end);
  const aLevels = waveLevels(
    aTimes,
    aBeats.map((beat) => beat.time),
    4,
  ).map((level, i) => level * gains(state, aTimes[i]!).a);
  const bLevels = waveLevels(
    bTimes,
    bBeats.map((beat) => beat.time),
    11,
  ).map((level, i) => level * gains(state, bTimes[i]!).b);
  const held = state === "bus" ? columns(-1.2, 0) : [];
  return {
    aWave: barsPath(aTimes, aLevels, toX, LANES.aWave, 2.2),
    bWave: barsPath(bTimes, bLevels, toX, LANES.bWave, 2.2),
    bHeld: held.length
      ? barsPath(
          held,
          waveLevels(
            held,
            bBeats.map((beat) => beat.time - 1.2),
            9,
          ),
          toX,
          LANES.bWave,
          2.2,
        )
      : "",
    aTicks: ticksPath(aBeats, toX, LANES.aGrid, WINDOW),
    reference: ticksPath(
      aBeats,
      toX,
      { top: LANES.aGrid.top, bottom: LANES.bGrid.bottom },
      WINDOW,
    ).down,
    offsets: offset
      ? bBeats
          .filter((beat) => beat.beat % 4 === 0)
          .map((beat) => {
            const y = ((LANES.aGrid.bottom + LANES.bGrid.top) / 2).toFixed(1);
            return `M${toX(beat.time - offset).toFixed(1)} ${y}H${toX(beat.time).toFixed(1)}`;
          })
          .join("")
      : "",
    bTicks: ticksPath(bBeats, toX, LANES.bGrid, WINDOW),
    gainA: curve(state, "a", LANES.gain),
    gainB: curve(state, "b", LANES.gain),
    plannedA: state === "timer" ? curve(state, "a", LANES.gain, true) : "",
    plannedB: state === "timer" ? curve(state, "b", LANES.gain, true) : "",
  };
}
