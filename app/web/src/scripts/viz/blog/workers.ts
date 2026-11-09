import type { PhaseTrack } from "./phase-clock";

/**
 * H12 figure: one listening session meeting the resource governor of 09da2273.
 * From that commit: the thresholds (load ratio 0.85, iowait 25 %, swap 30 %,
 * listeners and streams above 0), the 5 and 3 minute `ended_at` windows,
 * DEFAULT_DEFER_SECONDS, the analysis daemon's LOAD_PAUSE and
 * ANALYSIS_BATCH_SIZE, playback priority 0 and one slot per worker (one
 * process, `--threads 1`). The playback worker itself dates from 1b5f36a1.
 * The session, job durations and gauge samples are an example, compressed.
 */

export type WorkersState = "admission";
export type Lane = "maintenance" | "analysis" | "playback";
export type Zone = "waiting" | "gate" | "slot" | "done";
export type JobId =
  | "repair-running"
  | "repair-next"
  | "batch-claimed"
  | "batch-next"
  | "variant-a"
  | "variant-b";
export type JobState =
  | "queued"
  | "checking"
  | "deferred"
  | "running"
  | "pending"
  | "preparing"
  | "done";

export const GOVERNOR = {
  loadRatio: 0.85,
  iowaitPercent: 25,
  swapPercent: 30,
  maxActiveUsers: 0,
  maxActiveStreams: 0,
  usersWindow: 5 * 60,
  streamsWindow: 3 * 60,
  deferSeconds: 300,
} as const;
export const LOAD_PAUSE = 60;
export const ANALYSIS_BATCH_SIZE = 8;
export const PLAYBACK_PRIORITY = 0;

/** The activity track shows the last six minutes; one unit is one second. */
export const ACTIVITY = {
  span: 6 * 60,
  height: 100,
  users: 14,
  streams: 38,
  band: [52, 62] as const,
  tick: [47, 67] as const,
  axis: 84,
};

/** Pill centres along a lane track, in % of its width. */
export const ZONE_X: Record<Zone, number> = {
  waiting: 15,
  gate: 35,
  slot: 62,
  done: 91,
};
export const ZONE_EDGES = [28, 42, 82] as const;

export const WORKERS_STATES = [
  {
    id: "admission",
    label: "Admission",
    phases: [
      {
        title: "Play",
        body: "A listener presses Play and `prepare_stream_variant` gets the playback slot. No play event exists until a track ends.",
      },
      {
        title: "Defer",
        body: "A play event lands. The next repair goes back with the same task ID and a 300 s delay; analysis sleeps 60 s.",
      },
      {
        title: "Hold",
        body: "The maintenance slot stays free. After 300 s the gate asks again, and a recent play sends the task back.",
      },
      {
        title: "Retry",
        body: "Listening has stopped and both windows are empty. Analysis claims 8 rows and the same repair task runs.",
      },
    ],
  },
] as const satisfies readonly {
  id: WorkersState;
  label: string;
  phases: readonly { title: string; body: string }[];
}[];

// Example session, in story seconds since Play.
export const PLAYS = [
  { id: "a", start: 0, end: 200 },
  { id: "b", start: 200, end: 410 },
] as const;
const REPAIR_FREES_SLOT = 240;
const REPAIR_PROGRESS_AT_PLAY = 0.35;
const RETRIED_REPAIR_SECONDS = 600;
const CELLS_AT_PLAY = 3;
const SECONDS_PER_TRACK = 45;
const BATCH_DONE = (ANALYSIS_BATCH_SIZE - CELLS_AT_PLAY) * SECONDS_PER_TRACK;
const VARIANTS = [
  { id: "variant-a", enqueued: 0, start: 2, end: 40 },
  { id: "variant-b", enqueued: 200, start: 202, end: 232 },
] as const;
const STORY_END = 880;

export function activityAt(s: number): { users: number; streams: number } {
  const ended = PLAYS.filter((play) => play.end <= s);
  const recent = (window: number) =>
    ended.filter((play) => play.end > s - window).length;
  // One listener: active_users counts distinct users, active_streams rows.
  return {
    users: recent(GOVERNOR.usersWindow) > 0 ? 1 : 0,
    streams: recent(GOVERNOR.streamsWindow),
  };
}

function listenerReasons(s: number): string[] {
  const { users, streams } = activityAt(s);
  const reasons: string[] = [];
  if (users > GOVERNOR.maxActiveUsers)
    reasons.push(`${users} active listener(s)>${GOVERNOR.maxActiveUsers}`);
  if (streams > GOVERNOR.maxActiveStreams)
    reasons.push(`${streams} recent stream(s)>${GOVERNOR.maxActiveStreams}`);
  return reasons;
}

export interface Check {
  at: number;
  allowed: boolean;
}

function checks(first: number, step: number): Check[] {
  const list: Check[] = [];
  for (let at = first; list.length < 40; at += step) {
    const allowed = listenerReasons(at).length === 0;
    list.push({ at, allowed });
    if (allowed) break;
  }
  return list;
}

/** `should_defer_task` each time the repair message reaches the worker. */
export const REPAIR_CHECKS = checks(REPAIR_FREES_SLOT, GOVERNOR.deferSeconds);
/** `_should_pause_for_load` at the top of each analysis loop. */
export const ANALYSIS_CHECKS = checks(BATCH_DONE, LOAD_PAUSE);
const REPAIR_ADMIT = REPAIR_CHECKS.at(-1)!.at;
const ANALYSIS_ADMIT = ANALYSIS_CHECKS.at(-1)!.at;

// Figure time → story time. Slow where a job moves, fast through the waits.
const KNOTS: readonly (readonly [number, number])[] = [
  [0, 0],
  [1.4, 48],
  [2.4, 200],
  [3.9, REPAIR_CHECKS[0]!.at],
  [4.8, 250],
  [6.2, REPAIR_CHECKS[1]!.at],
  [7.2, 600],
  [7.9, ANALYSIS_ADMIT],
  [8.5, REPAIR_ADMIT],
  [9.6, STORY_END],
];

function interpolate(value: number, from: 0 | 1, to: 0 | 1): number {
  const first = KNOTS[0]!;
  const last = KNOTS.at(-1)!;
  if (value <= first[from]) return first[to];
  for (let i = 1; i < KNOTS.length; i++) {
    const a = KNOTS[i - 1]!;
    const b = KNOTS[i]!;
    if (value <= b[from])
      return a[to] + ((value - a[from]) / (b[from] - a[from])) * (b[to] - a[to]);
  }
  return last[to];
}

export const storyTime = (t: number) => interpolate(t, 0, 1);
export const figureTime = (s: number) => interpolate(s, 1, 0);

export const WORKERS_TRACKS: Record<WorkersState, PhaseTrack> = {
  admission: {
    period: KNOTS.at(-1)![0],
    starts: [0, 2.4, 4.8, 7.2],
    pins: [1.0, 4.62, 6.95, 9.4],
  },
};

const MOVE = 0.3;
const HOLD = 0.12;
const BACK = 0.45;
const ENTER = 0.35;

const clamp01 = (k: number) => Math.min(1, Math.max(0, k));
const ease = (k: number) => {
  const t = clamp01(k);
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
};

type Stop = readonly [t: number, x: number];

function along(stops: readonly Stop[], t: number): number {
  if (t <= stops[0]![0]) return stops[0]![1];
  for (let i = 1; i < stops.length; i++) {
    const [t0, x0] = stops[i - 1]!;
    const [t1, x1] = stops[i]!;
    if (t <= t1) return t1 === t0 ? x1 : x0 + (x1 - x0) * ease((t - t0) / (t1 - t0));
  }
  return stops.at(-1)![1];
}

/** A message or claim that walks to the gate at each check. */
function gateStops(list: readonly Check[]): Stop[] {
  const { waiting, gate, slot } = ZONE_X;
  const stops: Stop[] = [[0, waiting]];
  for (const check of list) {
    const t = figureTime(check.at);
    stops.push([t, waiting], [t + MOVE, gate], [t + MOVE + HOLD, gate]);
    stops.push(check.allowed ? [t + MOVE + HOLD + ENTER, slot] : [t + MOVE + HOLD + BACK, waiting]);
  }
  return stops;
}

/** The last check a gated job has reached at figure time t. */
function visit(list: readonly Check[], t: number) {
  let last: { check: Check; index: number; since: number } | null = null;
  list.forEach((check, index) => {
    const since = t - figureTime(check.at);
    if (since >= 0) last = { check, index, since };
  });
  return last as { check: Check; index: number; since: number } | null;
}

function gatedState(list: readonly Check[], t: number, idle: JobState): JobState {
  const at = visit(list, t);
  if (!at || at.since < MOVE) return idle;
  if (at.since < MOVE + HOLD) return "checking";
  return at.check.allowed ? "running" : "deferred";
}

const nearestZone = (x: number): Zone =>
  (Object.entries(ZONE_X) as [Zone, number][]).reduce((best, entry) =>
    Math.abs(entry[1] - x) < Math.abs(best[1] - x) ? entry : best,
  )[0];

export interface JobFrame {
  id: JobId;
  lane: Lane;
  x: number;
  zone: Zone;
  state: JobState;
  /** Fill of the pill: work done, or the share of a deferral delay left. */
  progress: number;
  /** Tracks analysed in a batch of ANALYSIS_BATCH_SIZE. */
  cells: number;
  /** Seconds until a deferred message is delivered again. */
  delay: number | null;
  opacity: number;
}

export interface PlayFrame {
  id: string;
  x0: number;
  x1: number;
  recorded: boolean;
  visible: boolean;
}

export interface WorkersFrame {
  story: number;
  clock: string;
  activity: {
    users: number;
    streams: number;
    listening: boolean;
    plays: PlayFrame[];
  };
  gauges: { loadRatio: number; iowaitPercent: number; swapPercent: number };
  decision: { allowed: boolean; reason: string };
  jobs: JobFrame[];
  lanes: {
    maintenance: {
      governed: true;
      busy: boolean;
      deferrals: number;
      done: number;
      gate: "allow" | "defer";
      checking: boolean;
    };
    analysis: {
      governed: true;
      sleeping: boolean;
      checks: number;
      stored: number;
      gate: "allow" | "defer";
      checking: boolean;
    };
    playback: { governed: false; busy: boolean; ready: number };
  };
}

const repairRunning = (s: number) => s < REPAIR_FREES_SLOT || s >= REPAIR_ADMIT;
const analysisRunning = (s: number) => s < BATCH_DONE || s >= ANALYSIS_ADMIT;
const variantPreparing = (s: number) =>
  VARIANTS.some((variant) => s >= variant.start && s < variant.end);

const demand = (s: number) =>
  0.28 +
  (repairRunning(s) ? 0.24 : 0) +
  (analysisRunning(s) ? 0.22 : 0) +
  (variantPreparing(s) ? 0.06 : 0);

// The 1-minute load average follows demand with a 60 s time constant.
const LOAD_FROM = -600;
const LOAD: number[] = (() => {
  const values: number[] = [];
  let level = demand(LOAD_FROM);
  for (let s = LOAD_FROM; s <= STORY_END + 1; s++) {
    level += (demand(s) - level) * (1 - Math.exp(-1 / 60));
    values.push(level);
  }
  return values;
})();

function gaugesAt(s: number) {
  const i = Math.min(LOAD.length - 2, Math.max(0, s - LOAD_FROM));
  const k = i - Math.floor(i);
  const load = LOAD[Math.floor(i)]! * (1 - k) + LOAD[Math.floor(i) + 1]! * k;
  return {
    loadRatio: load + 0.015 * Math.sin(s / 9),
    iowaitPercent:
      3 +
      (repairRunning(s) ? 9 : 0) +
      (analysisRunning(s) ? 6 : 0) +
      (variantPreparing(s) ? 3 : 0) +
      Math.sin(s / 5),
    swapPercent: 12 + 0.2 * Math.sin(s / 40),
  };
}

function decide(s: number, gauges: WorkersFrame["gauges"]) {
  const reasons = listenerReasons(s);
  if (gauges.loadRatio > GOVERNOR.loadRatio)
    reasons.push(`load ${gauges.loadRatio.toFixed(2)}>${GOVERNOR.loadRatio.toFixed(2)}`);
  if (gauges.iowaitPercent > GOVERNOR.iowaitPercent)
    reasons.push(`iowait ${gauges.iowaitPercent.toFixed(1)}%>${GOVERNOR.iowaitPercent.toFixed(1)}%`);
  if (gauges.swapPercent > GOVERNOR.swapPercent)
    reasons.push(`swap ${gauges.swapPercent.toFixed(1)}%>${GOVERNOR.swapPercent.toFixed(1)}%`);
  return { allowed: reasons.length === 0, reason: reasons.join(", ") };
}

function playsAt(s: number): PlayFrame[] {
  const from = s - ACTIVITY.span;
  return PLAYS.map((play) => {
    const end = Math.min(play.end, s);
    return {
      id: play.id,
      x0: Math.max(0, play.start - from),
      x1: Math.max(0, end - from),
      recorded: play.end <= s,
      visible: play.start <= s && end > from,
    };
  });
}

const clockText = (s: number) => {
  const whole = Math.max(0, Math.floor(s));
  return `+${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

/** A job that leaves its slot for the done zone and fades there. */
function finish(t: number, at: number) {
  const tEnd = figureTime(at);
  return {
    x: along([[tEnd, ZONE_X.slot], [tEnd + ENTER, ZONE_X.done]], t),
    opacity: 1 - clamp01((t - tEnd - 0.1) / ENTER),
  };
}

export function workersFrame(t: number): WorkersFrame {
  const s = storyTime(t);
  const gauges = gaugesAt(s);
  const decision = decide(s, gauges);
  const activity = activityAt(s);
  const listening = PLAYS.some((play) => s >= play.start && s < play.end);

  const repairDone = s >= REPAIR_FREES_SLOT;
  const runningRepair: JobFrame = {
    id: "repair-running",
    lane: "maintenance",
    ...finish(t, REPAIR_FREES_SLOT),
    zone: "slot",
    state: repairDone ? "done" : "running",
    progress: Math.min(1, REPAIR_PROGRESS_AT_PLAY + ((1 - REPAIR_PROGRESS_AT_PLAY) * s) / REPAIR_FREES_SLOT),
    cells: 0,
    delay: null,
  };

  const repairState = gatedState(REPAIR_CHECKS, t, "queued");
  const refused = REPAIR_CHECKS.filter((check) => !check.allowed);
  const nextCheck = REPAIR_CHECKS.find((check) => check.at > s);
  const delay = repairState === "deferred" && nextCheck ? nextCheck.at - s : null;
  const nextRepair: JobFrame = {
    id: "repair-next",
    lane: "maintenance",
    x: along(gateStops(REPAIR_CHECKS), t),
    zone: "waiting",
    state: repairState,
    progress:
      repairState === "running"
        ? clamp01((s - REPAIR_ADMIT) / RETRIED_REPAIR_SECONDS)
        : delay !== null
          ? delay / GOVERNOR.deferSeconds
          : 0,
    cells: 0,
    delay,
    opacity: 1,
  };

  const claimed: JobFrame = {
    id: "batch-claimed",
    lane: "analysis",
    ...finish(t, BATCH_DONE),
    zone: "slot",
    state: s < BATCH_DONE ? "running" : "done",
    progress: 0,
    cells: Math.min(ANALYSIS_BATCH_SIZE, CELLS_AT_PLAY + Math.floor(s / SECONDS_PER_TRACK)),
    delay: null,
  };

  const batchState = gatedState(ANALYSIS_CHECKS.slice(-1), t, "pending");
  const nextBatch: JobFrame = {
    id: "batch-next",
    lane: "analysis",
    x: along(gateStops(ANALYSIS_CHECKS.slice(-1)), t),
    zone: "waiting",
    state: batchState,
    progress: 0,
    cells:
      batchState === "running"
        ? Math.min(ANALYSIS_BATCH_SIZE, Math.floor((s - ANALYSIS_ADMIT) / SECONDS_PER_TRACK))
        : 0,
    delay: null,
    opacity: 1,
  };

  const variants: JobFrame[] = VARIANTS.map((variant) => {
    const tIn = figureTime(variant.enqueued);
    const tOut = figureTime(variant.end);
    const done = s >= variant.end;
    return {
      id: variant.id,
      lane: "playback",
      x: along([[tIn, 30], [tIn + ENTER, ZONE_X.slot], [tOut, ZONE_X.slot], [tOut + ENTER, ZONE_X.done]], t),
      zone: "slot",
      state: done ? "done" : s >= variant.start ? "preparing" : "queued",
      progress: clamp01((s - variant.start) / (variant.end - variant.start)),
      cells: 0,
      delay: null,
      opacity:
        t < tIn ? 0 : Math.min(clamp01((t - tIn) / 0.15), 1 - clamp01((t - tOut - 0.1) / ENTER)),
    };
  });

  const jobs = [runningRepair, nextRepair, claimed, nextBatch, ...variants].map((job) => ({
    ...job,
    zone: nearestZone(job.x),
  }));

  const gate = decision.allowed ? ("allow" as const) : ("defer" as const);
  const tBatchGate = figureTime(ANALYSIS_ADMIT) + MOVE;

  return {
    story: s,
    clock: clockText(s),
    activity: { ...activity, listening, plays: playsAt(s) },
    gauges,
    decision,
    jobs,
    lanes: {
      maintenance: {
        governed: true,
        busy: runningRepair.state === "running" || nextRepair.state === "running",
        deferrals: refused.filter((check) => t >= figureTime(check.at) + MOVE + HOLD).length,
        done: repairDone ? 1 : 0,
        gate,
        checking: nextRepair.state === "checking",
      },
      analysis: {
        governed: true,
        sleeping: s >= BATCH_DONE && t < tBatchGate,
        checks: ANALYSIS_CHECKS.filter((check) => !check.allowed && check.at <= s).length,
        stored: s >= BATCH_DONE ? ANALYSIS_BATCH_SIZE : 0,
        gate,
        checking: nextBatch.state === "checking",
      },
      playback: {
        governed: false,
        busy: variants.some((variant) => variant.state === "preparing"),
        ready: variants.filter((variant) => variant.state === "done").length,
      },
    },
  };
}

export const GAUGES = [
  { id: "loadRatio", label: "Load ratio", limit: GOVERNOR.loadRatio, max: 1.2, unit: "", digits: 2 },
  { id: "iowaitPercent", label: "iowait", limit: GOVERNOR.iowaitPercent, max: 40, unit: " %", digits: 0 },
  { id: "swapPercent", label: "Swap", limit: GOVERNOR.swapPercent, max: 60, unit: " %", digits: 0 },
] as const;

export const gaugeText = (gauge: (typeof GAUGES)[number], value: number) =>
  `${value.toFixed(gauge.digits)}${gauge.unit}`;

/** Every string the scene shows that changes with time. */
export function sceneLabels(frame: WorkersFrame) {
  const repair = frame.jobs.find((job) => job.id === "repair-next")!;
  const { maintenance, analysis, playback } = frame.lanes;
  return {
    clock: frame.clock,
    verdict: frame.decision.allowed ? "Allow" : "Defer",
    reason: frame.decision.allowed ? "no check over its limit" : frame.decision.reason,
    users: String(frame.activity.users),
    streams: String(frame.activity.streams),
    delay: repair.delay === null ? "" : `${Math.ceil(repair.delay)} s`,
    arc: `deferred ×${Math.max(1, maintenance.deferrals)} · +${GOVERNOR.deferSeconds} s`,
    sleep: `sleep ${LOAD_PAUSE} s${analysis.checks ? ` · ×${analysis.checks}` : ""}`,
    done: {
      maintenance: String(maintenance.done),
      analysis: String(analysis.stored),
      playback: String(playback.ready),
    },
  };
}

type Tone = "warn" | "ok" | undefined;

interface Reading {
  text: string;
  tone: Tone;
  note: string;
}

export function workersReadout(frame: WorkersFrame): {
  governor: Reading;
  repair: Reading;
  playback: Reading;
  interrupted: Reading;
} {
  const repair = frame.jobs.find((job) => job.id === "repair-next")!;
  const { allowed } = frame.decision;
  const { users, streams } = frame.activity;
  const ready = frame.lanes.playback.ready;
  return {
    governor: allowed
      ? { text: "Allow", tone: "ok", note: "no reason" }
      : { text: "Defer", tone: "warn", note: `${users} user · ${streams} stream${streams === 1 ? "" : "s"}` },
    repair:
      repair.state === "running"
        ? { text: "Running", tone: "ok", note: "same task" }
        : repair.state === "deferred"
          ? { text: "Pending", tone: "warn", note: `delay ${Math.ceil(repair.delay ?? 0)} s` }
          : repair.state === "checking"
            ? { text: "Pending", tone: undefined, note: "at the gate" }
            : { text: "Pending", tone: undefined, note: "queued" },
    playback: frame.lanes.playback.busy
      ? { text: "Preparing", tone: "ok", note: "own slot" }
      : { text: "Free", tone: undefined, note: ready ? `${ready} ready` : "idle" },
    interrupted: { text: "None", tone: undefined, note: "jobs finish" },
  };
}
