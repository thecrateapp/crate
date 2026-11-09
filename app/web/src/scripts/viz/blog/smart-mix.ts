import { barsPath, columnTimes, type Lane } from "../inside-math";
import { easeInOut, waveLevels } from "../mix-math";
import type { PhaseTrack } from "./phase-clock";

/**
 * H34 figure: where Smart Mix places one transition between two synthetic
 * tracks, under v2 (the default planner), v3 with phrase structure, and v3
 * with that structure removed. Tracks, phrases, energy and voice bytes are the
 * `voiced_dj` case of app/tests/smart_mix_candidate_cases.py; plans and metrics
 * were exported from the planner and evaluator at 6b53412a
 * (tools/smart-mix-eval/export_blog_fixture.py). The clash, alignment and
 * crossfade rules below port app/crate/smart_mix/evaluation.py at that commit,
 * and the model test checks them against the exported metrics.
 */

export type SmartMixState = "v2" | "v3" | "no-structure";
export type PlanId = "v2" | "v3" | "alternative" | "missing-structure";
export type Span = readonly [number, number];
type Tone = "warn" | "ok" | undefined;

export interface FixturePhrase {
  index: number;
  kind: string;
  bars: number;
  startMs: number;
  endMs: number;
  energy: number;
  voiceByte: number;
}

export interface FixtureTrack {
  durationMs: number;
  activeStartMs: number;
  activeEndMs: number;
  bpm: number;
  beatMs: number;
  phrases: readonly FixturePhrase[];
}

export interface FixtureChoice {
  id: string;
  rank: number | null;
  plan: {
    mode: string;
    durationMs: number;
    curve: string;
    outgoingCueMs: number;
    incomingCueMs: number;
  };
  geometry: {
    outgoingStartMs: number;
    outgoingEndMs: number;
    incomingStartMs: number;
    incomingEndMs: number;
    incomingPlaybackRate: number;
  };
  metrics: { vocalClashMs: number | null };
}

export interface SmartMixFixture {
  tracks: { outgoing: FixtureTrack; incoming: FixtureTrack };
  choices: readonly FixtureChoice[];
  fallback: FixtureChoice;
}

// evaluation.py: OVERLAP_FLOOR_GAIN, DJ_BLEND_ENTRY/EXIT, TIMELINE_STEP_MS,
// PHRASE_TOLERANCE_BEATS, GRID_PHRASE_BARS; models.py: VOCAL_THRESHOLD;
// policy.py: outgoing_phrase_choices, incoming_phrase_choices.
const FULL_LEVEL = 0.5;
const FULL_LEVEL_DB = 20 * Math.log10(FULL_LEVEL);
const DJ_BLEND_ENTRY = 0.3;
const DJ_BLEND_EXIT = 0.7;
const STEP_MS = 10;
const TOLERANCE_BEATS = 0.125;
const GRID_BARS = 8;
const BEATS_PER_BAR = 4;
export const VOICE_THRESHOLD = 90;
const OUTGOING_CHOICES = 4;
const INCOMING_CHOICES = 3;

export const SMART_MIX_STATES = [
  {
    id: "v2",
    label: "v2 · default",
    phases: [
      {
        title: "Cue to cue",
        body: "The default planner starts at A's outro cue and B's intro cue and fits 16 bars on the downbeat grid.",
      },
      {
        title: "Voices meet",
        body: "v2 does not read voice, so both windows stay voiced and the evaluator counts 19.42 s with both gains at half or more.",
      },
      {
        title: "All played",
        body: "The mix ends where A's music ends and starts where B's begins, so no active music is left out.",
      },
    ],
  },
  {
    id: "v3",
    label: "v3 · structure",
    phases: [
      {
        title: "Menu",
        body: "Requested as `smart-mix-v3`, the planner pairs A's last four phrase starts with B's first three and adds v2's own plan.",
      },
      {
        title: "Voice penalty",
        body: "Scored on the same phrases, v2's outro into intro carries 19.42 s of clash, which the vocal term subtracts.",
      },
      {
        title: "Runner-up",
        body: "Eight bars from A's outro into B's build avoid the clash but skip B's 30.72 s intro and 15.36 s of A's outro.",
      },
      {
        title: "First choice",
        body: "The winner exits from A's break into B's intro: no clash, and 92.16 s of A stay unplayed.",
      },
    ],
  },
  {
    id: "no-structure",
    label: "v3 · no structure",
    phases: [
      {
        title: "Remove structure",
        body: "With phrases, energy curve and voice removed from both profiles, the first v3 candidate is exactly v2's plan.",
      },
      {
        title: "Bar grid",
        body: "Alignment falls back to an 8-bar grid from the downbeat, and all four mix boundaries land on it.",
      },
      {
        title: "Voice unknown",
        body: "Without voice data the clash is unknown, not zero: neither track becomes instrumental.",
      },
    ],
  },
] as const satisfies readonly {
  id: SmartMixState;
  label: string;
  phases: readonly { title: string; body: string }[];
}[];

export const SMART_MIX_TRACKS: Record<SmartMixState, PhaseTrack> = {
  v2: { period: 10, starts: [0, 3.4, 7.2], pins: [3.2, 7.0, 9.8] },
  v3: { period: 10, starts: [0, 2.2, 5.2, 7.6], pins: [2.0, 5.1, 7.5, 9.9] },
  "no-structure": { period: 10, starts: [0, 3.4, 6.6], pins: [3.2, 6.4, 9.9] },
};

/** The plan each phase shows, by fixture id. */
export const PHASE_PLANS: Record<SmartMixState, readonly PlanId[]> = {
  v2: ["v2", "v2", "v2"],
  v3: ["v2", "v2", "alternative", "v3"],
  "no-structure": [
    "missing-structure",
    "missing-structure",
    "missing-structure",
  ],
};

export const PLAN_NAMES: Record<PlanId, string> = {
  v2: "v2 plan",
  v3: "first choice",
  alternative: "runner-up",
  "missing-structure": "first choice = v2 plan",
};

type Motion =
  | { kind: "hold" }
  | { kind: "grow"; from: number; to: number }
  | { kind: "slide"; plan: PlanId; from: number; to: number };

interface PhaseScript {
  motion: Motion;
  /** The playhead crosses the mix between these figure times. */
  sweep?: readonly [number, number];
  /** Whether the mix lane is lit when the phase has no sweep. */
  lit?: boolean;
}

const HOLD: Motion = { kind: "hold" };

const SCRIPTS: Record<SmartMixState, readonly PhaseScript[]> = {
  v2: [
    { motion: { kind: "grow", from: 0.4, to: 2.8 } },
    { motion: HOLD, sweep: [3.6, 6.8] },
    { motion: HOLD, lit: true },
  ],
  v3: [
    { motion: HOLD },
    { motion: HOLD, sweep: [2.5, 5.0] },
    { motion: { kind: "slide", plan: "v2", from: 5.2, to: 6.0 }, sweep: [6.1, 7.3] },
    {
      motion: { kind: "slide", plan: "alternative", from: 7.6, to: 8.4 },
      sweep: [8.5, 9.7],
    },
  ],
  "no-structure": [
    { motion: { kind: "slide", plan: "v3", from: 1.2, to: 2.2 } },
    { motion: HOLD },
    { motion: HOLD, sweep: [6.8, 9.4] },
  ],
};

/** The fallback strips structure at this figure time. */
const STRIP_AT = 0.6;
const CANDIDATES_AT = 0.3;
const GRID_AT = 3.6;

// --- planner rules ----------------------------------------------------------

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));
const smoothstep = (value: number) => {
  const p = clamp01(value);
  return p * p * (3 - 2 * p);
};

function djBlendProgress(progress: number): number {
  const p = clamp01(progress);
  if (p <= DJ_BLEND_ENTRY) return 0.5 * smoothstep(p / DJ_BLEND_ENTRY);
  if (p < DJ_BLEND_EXIT) return 0.5;
  return 0.5 + 0.5 * smoothstep((p - DJ_BLEND_EXIT) / (1 - DJ_BLEND_EXIT));
}

/** evaluation.crossfade_gains: linear outgoing and incoming gains. */
export function crossfadeGains(
  progress: number,
  curve: string,
): { a: number; b: number } {
  const k = curve === "dj-blend" ? djBlendProgress(progress) : clamp01(progress);
  return {
    a: k >= 1 ? 0 : Math.cos((k * Math.PI) / 2),
    b: Math.sin((k * Math.PI) / 2),
  };
}

const fullLevel = (gain: number) =>
  gain > 0 && 20 * Math.log10(gain) >= FULL_LEVEL_DB;

/** Mix progress range with both decks at half gain or more. */
export function fullLevelSpan(curve: string): [number, number] {
  let from = 1;
  let to = 0;
  for (let i = 0; i <= 10000; i++) {
    const p = i / 10000;
    const { a, b } = crossfadeGains(p, curve);
    if (fullLevel(a) && fullLevel(b)) {
      from = Math.min(from, p);
      to = Math.max(to, p);
    }
  }
  return [from, to];
}

export function phraseAt(
  track: FixtureTrack,
  ms: number,
): FixturePhrase | undefined {
  let found: FixturePhrase | undefined;
  for (const phrase of track.phrases) if (phrase.startMs <= ms) found = phrase;
  return found && ms < found.endMs ? found : undefined;
}

const voiced = (track: FixtureTrack, ms: number) =>
  (phraseAt(track, ms)?.voiceByte ?? 0) >= VOICE_THRESHOLD;

const sounding = (track: FixtureTrack, ms: number) =>
  track.activeStartMs <= ms && ms < Math.min(track.activeEndMs, track.durationMs);

/** Phrases start on the first downbeat (`ANCHOR_MS` in the test cases). */
const downbeat = (track: FixtureTrack) => track.phrases[0]?.startMs ?? 0;
const barMs = (track: FixtureTrack) => BEATS_PER_BAR * track.beatMs;

function boundaries(track: FixtureTrack, structure: boolean): number[] {
  if (structure)
    return [
      ...new Set(track.phrases.flatMap((phrase) => [phrase.startMs, phrase.endMs])),
    ];
  const step = GRID_BARS * barMs(track);
  const list: number[] = [];
  for (let ms = downbeat(track); ms <= track.durationMs; ms += step) list.push(ms);
  return list;
}

const merge = (samples: number[]): Span[] => {
  const spans: [number, number][] = [];
  for (const start of samples) {
    const last = spans.at(-1);
    if (last && Math.abs(last[1] - start) < 1e-6) last[1] = start + STEP_MS;
    else spans.push([start, start + STEP_MS]);
  }
  return spans;
};

export interface PlanSummary {
  id: PlanId;
  rank: number | null;
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
  durationMs: number;
  ratio: number;
  curve: string;
  /** Exported vocal clash; null when either profile lacks voice. */
  clashMs: number | null;
  /** Mix-time spans with voice on both decks at full level. */
  clash: Span[] | null;
  /** Mix-time spans each deck is voiced. */
  voice: { a: Span[]; b: Span[] } | null;
  fullLevel: Span;
  /** A start, A end, B start, B end on a phrase (or grid) boundary. */
  aligned: [boolean, boolean, boolean, boolean];
  basis: "phrases" | "grid";
}

function summarize(
  fixture: SmartMixFixture,
  choice: FixtureChoice,
  structure: boolean,
): PlanSummary {
  const { outgoing, incoming } = fixture.tracks;
  const g = choice.geometry;
  const duration = choice.plan.durationMs;
  const ratio = g.incomingPlaybackRate;
  const curve = choice.plan.mode === "beatmatch" ? choice.plan.curve : "equal-power";
  const [from, to] = fullLevelSpan(curve);

  let clash: Span[] | null = null;
  if (structure) {
    // evaluation._overlap_ms with _both_full_level and both voiced.
    const samples: number[] = [];
    for (let start = 0; start < duration; start += STEP_MS) {
      const width = Math.min(STEP_MS, duration - start);
      const position = start + width / 2;
      const { a, b } = crossfadeGains(position / duration, curve);
      if (!fullLevel(a) || !fullLevel(b)) continue;
      const aMs = g.outgoingStartMs + position;
      const bMs = g.incomingStartMs + position * ratio;
      if (!sounding(outgoing, aMs) || !sounding(incoming, bMs)) continue;
      if (voiced(outgoing, aMs) && voiced(incoming, bMs)) samples.push(start);
    }
    clash = merge(samples);
  }

  const voiceSpans = (track: FixtureTrack, start: number, rate: number) =>
    track.phrases
      .filter((phrase) => phrase.voiceByte >= VOICE_THRESHOLD)
      .flatMap((phrase): Span[] => {
        const left = Math.max(0, (phrase.startMs - start) / rate);
        const right = Math.min(duration, (phrase.endMs - start) / rate);
        return right > left ? [[left, right]] : [];
      });

  const near = (track: FixtureTrack, ms: number) => {
    const tolerance = TOLERANCE_BEATS * track.beatMs;
    return boundaries(track, structure).some(
      (boundary) => Math.abs(boundary - ms) <= tolerance,
    );
  };

  const clashMs = clash ? clash.reduce((sum, [l, r]) => sum + r - l, 0) : null;
  return {
    id: choice.id as PlanId,
    rank: choice.rank,
    aStart: g.outgoingStartMs,
    aEnd: g.outgoingEndMs,
    bStart: g.incomingStartMs,
    bEnd: g.incomingEndMs,
    durationMs: duration,
    ratio,
    curve,
    clashMs,
    clash,
    voice: structure
      ? {
          a: voiceSpans(outgoing, g.outgoingStartMs, 1),
          b: voiceSpans(incoming, g.incomingStartMs, ratio),
        }
      : null,
    fullLevel: [from * duration, to * duration],
    aligned: [
      near(outgoing, g.outgoingStartMs),
      near(outgoing, g.outgoingEndMs),
      near(incoming, g.incomingStartMs),
      near(incoming, g.incomingEndMs),
    ],
    basis: structure ? "phrases" : "grid",
  };
}

export function clashSpans(fixture: SmartMixFixture, id: PlanId): Span[] | null {
  return smartMixData(fixture).plans[id].clash;
}

/** candidates._phrase_options: the last outgoing and first incoming phrase starts. */
export function candidateStarts(fixture: SmartMixFixture) {
  const { outgoing, incoming } = fixture.tracks;
  return {
    outgoing: outgoing.phrases.slice(-OUTGOING_CHOICES).map((phrase) => phrase.startMs),
    incoming: incoming.phrases.slice(0, INCOMING_CHOICES).map((phrase) => phrase.startMs),
  };
}

export interface TrackBounds {
  durationMs: number;
  activeStartMs: number;
  activeEndMs: number;
}

/** Everything the client needs to render a frame; small enough to inline. */
export interface SmartMixData {
  barMs: number;
  plans: Record<PlanId, PlanSummary>;
  tracks: { outgoing: TrackBounds; incoming: TrackBounds };
  /** Phrase and 8-bar grid boundaries per track, for live alignment. */
  boundaries: Record<"outgoing" | "incoming", Record<"phrases" | "grid", number[]>>;
  toleranceMs: number;
}

export function smartMixData(fixture: SmartMixFixture): SmartMixData {
  const plans = Object.fromEntries([
    ...fixture.choices.map((choice) => [choice.id, summarize(fixture, choice, true)]),
    [fixture.fallback.id, summarize(fixture, fixture.fallback, false)],
  ]) as Record<PlanId, PlanSummary>;
  // Display the exported clash; the port above must agree within one sample.
  for (const choice of [...fixture.choices, fixture.fallback])
    plans[choice.id as PlanId].clashMs = choice.metrics.vocalClashMs;
  const bounds = ({ durationMs, activeStartMs, activeEndMs }: FixtureTrack) => ({
    durationMs,
    activeStartMs,
    activeEndMs,
  });
  const edges = (track: FixtureTrack) => ({
    phrases: boundaries(track, true),
    grid: boundaries(track, false),
  });
  return {
    barMs: barMs(fixture.tracks.outgoing),
    plans,
    tracks: {
      outgoing: bounds(fixture.tracks.outgoing),
      incoming: bounds(fixture.tracks.incoming),
    },
    boundaries: {
      outgoing: edges(fixture.tracks.outgoing),
      incoming: edges(fixture.tracks.incoming),
    },
    toleranceMs: TOLERANCE_BEATS * fixture.tracks.outgoing.beatMs,
  };
}

// --- frames -----------------------------------------------------------------

export interface MixWindow {
  aStart: number;
  aEnd: number;
  bStart: number;
  bEnd: number;
  durationMs: number;
}

export interface SmartMixFrame {
  state: SmartMixState;
  phase: number;
  plan: PlanSummary;
  window: MixWindow;
  structure: boolean;
  voiceKnown: boolean;
  candidates: boolean;
  grid: boolean;
  cues: boolean;
  ghost: boolean;
  bounds: boolean;
  /** A start, A end, B start, B end of the current window on a boundary. */
  aligned: boolean[];
  /** The window is still growing or sliding towards the phase's plan. */
  moving: boolean;
  /** Share of the mix the playhead has evaluated, 0..1. */
  reveal: number;
  playheadMs: number | null;
  evaluated: boolean;
}

const windowOf = (plan: PlanSummary): MixWindow => ({
  aStart: plan.aStart,
  aEnd: plan.aEnd,
  bStart: plan.bStart,
  bEnd: plan.bEnd,
  durationMs: plan.durationMs,
});

function lerpWindow(from: MixWindow, to: MixWindow, k: number): MixWindow {
  const lerp = (a: number, b: number) => a + (b - a) * k;
  return {
    aStart: lerp(from.aStart, to.aStart),
    aEnd: lerp(from.aEnd, to.aEnd),
    bStart: lerp(from.bStart, to.bStart),
    bEnd: lerp(from.bEnd, to.bEnd),
    durationMs: lerp(from.durationMs, to.durationMs),
  };
}

const phaseIndex = (track: PhaseTrack, t: number) => {
  let phase = 0;
  track.starts.forEach((start, i) => {
    if (t >= start) phase = i;
  });
  return phase;
};

export function smartMixFrame(
  data: SmartMixData,
  state: SmartMixState,
  t: number,
): SmartMixFrame {
  const phase = phaseIndex(SMART_MIX_TRACKS[state], t);
  const script = SCRIPTS[state][phase]!;
  const plan = data.plans[PHASE_PLANS[state][phase]!];
  const target = windowOf(plan);

  let window = target;
  const motion = script.motion;
  if (motion.kind === "grow") {
    const total = Math.round(plan.durationMs / data.barMs);
    const p = (t - motion.from) / (motion.to - motion.from);
    const bars = p < 0 ? 0 : p >= 1 ? total : Math.min(total, Math.floor(p * total) + 1);
    const duration = bars * data.barMs;
    window = {
      ...target,
      aEnd: target.aStart + duration,
      bEnd: target.bStart + duration * plan.ratio,
      durationMs: duration,
    };
  } else if (motion.kind === "slide") {
    const k = easeInOut((t - motion.from) / (motion.to - motion.from));
    window = lerpWindow(windowOf(data.plans[motion.plan]), target, k);
  }

  let reveal = script.lit ? 1 : 0;
  let playheadMs: number | null = null;
  if (script.sweep) {
    const [from, to] = script.sweep;
    if (t < from) reveal = 0;
    else if (t >= to) reveal = 1;
    else {
      reveal = (t - from) / (to - from);
      playheadMs = reveal * plan.durationMs;
    }
  }

  const stripped = state === "no-structure" && t >= STRIP_AT;
  const near = (role: "outgoing" | "incoming", ms: number) =>
    data.boundaries[role][plan.basis].some(
      (boundary) => Math.abs(boundary - ms) <= data.toleranceMs,
    );
  return {
    state,
    phase,
    plan,
    window,
    aligned: [
      near("outgoing", window.aStart),
      near("outgoing", window.aEnd),
      near("incoming", window.bStart),
      near("incoming", window.bEnd),
    ],
    moving: (["aStart", "aEnd", "bStart", "bEnd"] as const).some(
      (key) => Math.abs(window[key] - target[key]) > 0.5,
    ),
    structure: state === "v3" || (state === "no-structure" && !stripped),
    voiceKnown: state !== "no-structure" || !stripped,
    candidates: state === "v3" && t >= CANDIDATES_AT,
    grid: state === "no-structure" && t >= GRID_AT,
    cues: state === "v2" || stripped,
    ghost: state !== "v2",
    bounds: state === "v2" && phase === 2,
    reveal,
    playheadMs,
    evaluated: reveal > 0 || playheadMs !== null,
  };
}

/** Seconds with two decimals, as the article quotes them. */
export const formatSeconds = (ms: number) => (ms / 1000).toFixed(2);

const covered = (spans: readonly Span[], until: number) =>
  spans.reduce((sum, [l, r]) => sum + Math.max(0, Math.min(r, until) - l), 0);

export interface ReadoutValue {
  value: string;
  unit: string;
  tone?: Tone;
}

export function smartMixReadout(
  data: SmartMixData,
  frame: Pick<
    SmartMixFrame,
    "plan" | "window" | "reveal" | "evaluated" | "aligned" | "moving"
  >,
) {
  const { plan, window } = frame;
  const onBoundary = frame.aligned.filter(Boolean).length;
  const unplayed = Math.max(0, data.tracks.outgoing.activeEndMs - window.aEnd);
  const skipped = Math.max(0, window.bStart - data.tracks.incoming.activeStartMs);
  // Amber for music left out; cyan once a resting plan keeps it all.
  const omitted = (ms: number): ReadoutValue => ({
    value: formatSeconds(ms),
    unit: "s",
    tone: ms >= 5 ? "warn" : frame.moving ? undefined : "ok",
  });

  let clash: ReadoutValue;
  if (plan.clashMs === null || plan.clash === null)
    clash = { value: "Unknown", unit: "", tone: undefined };
  else if (!frame.evaluated) clash = { value: "—", unit: "", tone: undefined };
  else {
    const counted =
      frame.reveal >= 1
        ? plan.clashMs
        : Math.min(plan.clashMs, covered(plan.clash, frame.reveal * plan.durationMs));
    clash = {
      value: formatSeconds(counted),
      unit: "s",
      tone: counted > 0 ? "warn" : frame.reveal >= 1 ? "ok" : undefined,
    };
  }

  return {
    aligned: {
      value: `${onBoundary} / 4`,
      unit: plan.basis,
      tone: !frame.moving && onBoundary < 4 ? "warn" : undefined,
    } satisfies ReadoutValue,
    clash,
    aUnplayed: omitted(unplayed),
    bSkipped: omitted(skipped),
  };
}

// --- scene geometry -----------------------------------------------------------

export const VIEW = { width: 600, height: 330 };

/** Mix lane scale: a little longer than the longest exported plan. */
export const MIX_MS = 32_000;

export const LANES = {
  aTag: { top: 0, bottom: 12 },
  aPhrase: { top: 14, bottom: 26 },
  aWave: { top: 28, bottom: 76 },
  aVoice: { top: 79, bottom: 84 },
  aGrid: { top: 86, bottom: 94 },
  mix: { top: 124, bottom: 204 },
  mixAVoice: { top: 127, bottom: 132 },
  gain: { top: 138, bottom: 190 },
  mixBVoice: { top: 196, bottom: 201 },
  bGrid: { top: 234, bottom: 242 },
  bVoice: { top: 244, bottom: 249 },
  bWave: { top: 252, bottom: 300 },
  bPhrase: { top: 302, bottom: 314 },
  bTag: { top: 318, bottom: 330 },
} satisfies Record<string, Lane>;

const f = (value: number) => value.toFixed(1);

export const toSourceX = (ms: number, durationMs: number) =>
  (ms / durationMs) * VIEW.width;

export const toMixX = (ms: number) => (ms / MIX_MS) * VIEW.width;

/** Waveform columns whose envelope follows each phrase's fixture energy. */
export function wavePath(track: FixtureTrack, lane: Lane, seed: number): string {
  const seconds = track.durationMs / 1000;
  const toX = (s: number) => toSourceX(s * 1000, track.durationMs);
  const times = columnTimes(
    0,
    seconds,
    track.activeStartMs / 1000,
    track.activeEndMs / 1000,
    VIEW.width,
    4,
  );
  const beats: number[] = [];
  for (let ms = downbeat(track); ms < track.durationMs; ms += track.beatMs)
    beats.push(ms / 1000);
  const levels = waveLevels(times, beats, seed).map(
    (level, i) => (phraseAt(track, times[i]! * 1000)?.energy ?? 0) * (0.8 + 0.2 * level),
  );
  return barsPath(times, levels, toX, lane, 2.2);
}

export function spansPath(
  spans: readonly Span[],
  lane: Lane,
  toX: (ms: number) => number,
): string {
  return spans
    .map(
      ([l, r]) =>
        `M${f(toX(l))} ${lane.top}H${f(toX(r))}V${lane.bottom}H${f(toX(l))}Z`,
    )
    .join("");
}

export const voicedSpans = (track: FixtureTrack): Span[] =>
  track.phrases
    .filter((phrase) => phrase.voiceByte >= VOICE_THRESHOLD)
    .map((phrase) => [phrase.startMs, phrase.endMs]);

/** Every downbeat, and every eighth bar from the first downbeat. */
export function gridPaths(track: FixtureTrack, lane: Lane) {
  const short = lane.top + (lane.bottom - lane.top) * 0.45;
  let bars = "";
  let eights = "";
  const bar = barMs(track);
  for (let k = 0, ms = downbeat(track); ms <= track.activeEndMs; k++, ms = downbeat(track) + k * bar) {
    const x = f(toSourceX(ms, track.durationMs));
    if (k % GRID_BARS === 0) eights += `M${x} ${lane.top}V${lane.bottom}`;
    else bars += `M${x} ${f(short)}V${lane.bottom}`;
  }
  return { bars, eights };
}

export function phraseEdges(track: FixtureTrack, top: number, bottom: number): string {
  return boundaries(track, true)
    .map((ms) => `M${f(toSourceX(ms, track.durationMs))} ${top}V${bottom}`)
    .join("");
}

/** A ribbon from a source window to the mix lane: what plays together. */
export function lensPath(
  from: readonly [number, number],
  fromY: number,
  to: readonly [number, number],
  toY: number,
): string {
  const mid = (fromY + toY) / 2;
  return (
    `M${f(from[0])} ${fromY}C${f(from[0])} ${mid} ${f(to[0])} ${mid} ${f(to[0])} ${toY}` +
    `H${f(to[1])}C${f(to[1])} ${mid} ${f(from[1])} ${mid} ${f(from[1])} ${fromY}Z`
  );
}

export function gainPath(plan: PlanSummary, deck: "a" | "b", lane: Lane): string {
  let d = "";
  const steps = 120;
  for (let i = 0; i <= steps; i++) {
    const ms = (plan.durationMs * i) / steps;
    const gain = crossfadeGains(ms / plan.durationMs, plan.curve)[deck];
    const y = lane.bottom - gain * (lane.bottom - lane.top);
    d += `${i ? "L" : "M"}${f(toMixX(ms))} ${f(y)}`;
  }
  return d;
}

/** Height of half gain in the gain lane. */
export const halfGainY = (lane: Lane) => lane.bottom - FULL_LEVEL * (lane.bottom - lane.top);

export interface Extent {
  x: number;
  width: number;
}

export interface RangeTag {
  /** Window centre in % of the scene width. */
  left: number;
  anchor: "start" | "middle" | "end";
  text: string;
}

const extent = (from: number, to: number): Extent => ({
  x: from,
  width: Math.max(0, to - from),
});

const rangeTag = (from: number, to: number, x0: number, x1: number): RangeTag => {
  const centre = ((x0 + x1) / 2 / VIEW.width) * 100;
  return {
    left: centre,
    anchor: centre < 16 ? "start" : centre > 84 ? "end" : "middle",
    text: `${formatSeconds(from)}–${formatSeconds(to)} s`,
  };
};

/** Every position the view writes for a frame, in viewBox units. */
export function sceneGeometry(data: SmartMixData, frame: SmartMixFrame) {
  const { outgoing, incoming } = data.tracks;
  const { window, plan } = frame;
  const ax = (ms: number) => toSourceX(ms, outgoing.durationMs);
  const bx = (ms: number) => toSourceX(ms, incoming.durationMs);
  const a: [number, number] = [ax(window.aStart), ax(window.aEnd)];
  const b: [number, number] = [bx(window.bStart), bx(window.bEnd)];
  const mix: [number, number] = [0, toMixX(window.durationMs)];
  const bars = Math.round(window.durationMs / data.barMs);
  const counted =
    plan.clash && frame.evaluated
      ? covered(plan.clash, frame.reveal * plan.durationMs)
      : 0;
  return {
    aWin: extent(a[0], a[1]),
    aPlay: extent(ax(outgoing.activeStartMs), a[1]),
    aOmit: extent(a[1], ax(outgoing.activeEndMs)),
    bWin: extent(b[0], b[1]),
    bPlay: extent(b[0], bx(incoming.activeEndMs)),
    bOmit: extent(bx(incoming.activeStartMs), b[0]),
    lensA: lensPath(a, LANES.aGrid.bottom, mix, LANES.mix.top),
    lensB: lensPath(b, LANES.bGrid.top, mix, LANES.mix.bottom),
    extent: mix[1],
    lit: toMixX(frame.reveal * plan.durationMs),
    heads:
      frame.playheadMs === null
        ? null
        : {
            mix: toMixX(frame.playheadMs),
            a: ax(window.aStart + frame.playheadMs),
            b: bx(window.bStart + frame.playheadMs * plan.ratio),
          },
    edges: [a[0], a[1], b[0], b[1]].map((x, i) => ({
      x,
      aligned: frame.aligned[i]!,
    })),
    ranges: {
      a: rangeTag(window.aStart, window.aEnd, a[0], a[1]),
      b: rangeTag(window.bStart, window.bEnd, b[0], b[1]),
    },
    mix: {
      name: PLAN_NAMES[plan.id],
      detail: `${bars} ${bars === 1 ? "bar" : "bars"} · ${formatSeconds(window.durationMs)} s`,
    },
    clash: counted > 0,
  };
}

export type SceneGeometry = ReturnType<typeof sceneGeometry>;
