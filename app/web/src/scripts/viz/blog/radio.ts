import { phaseAt, type PhaseTrack } from "./phase-clock";

/**
 * H31 figure: four refills replayed from `blog-radio-fixture.json`, which
 * scripts/export_radio_fixture.py produces by running the selector, song
 * identity, significant-play threshold and delivery ledger from 924b7fb6 on
 * synthetic rows with fixed distances. Rankings, scores, statuses and picks
 * come from that export; this module only times their reveal. The server
 * builds the compact script below and the browser replays it without ranking.
 *
 * Constants, checked at 924b7fb6:
 * - radio_engine.py: `_RADIO_RECENCY_QUALITY_BAND = 0.05`, `_DELIVERED_SONG_LIMIT = 500`
 * - recommendation_policy.py: `SIGNIFICANT_PLAY_SECONDS = 30.0`,
 *   `SIGNIFICANT_PLAY_RATIO = 0.5`, `RECENT_PLAY_WINDOW = timedelta(days=7)`
 */

export const RADIO_COMMIT = "924b7fb6d08e0a9a80a8241ed41786aa7a770824";
export const QUALITY_BAND = 0.05;
export const DELIVERED_LIMIT = 500;
export const SIGNIFICANT_SECONDS = 30;
export const SIGNIFICANT_RATIO = 0.5;
export const HISTORY_DAYS = 7;
/** Scale of the play meter in seconds; the threshold tick sits at 30 s. */
export const METER_SECONDS = 60;
/** Most rows a refill shows; the fixture's largest pool has four. */
export const ROW_SLOTS = 4;

export type RadioState = "selector";

export const RADIO_STATES = [
  {
    id: "selector",
    label: "924b7fb6",
    phases: [
      {
        title: "Skip",
        body: "A 5 s skip stays out of history, but the session ledger cools Delivered X, so the refill takes Fresh at 0.40 with no 0.05 band.",
      },
      {
        title: "Listen",
        body: "A 30 s play puts `a · song`, live version included, in the 7-day history, and Fresh at 0.14 fits within 0.10 + 0.05.",
      },
      {
        title: "Keep recent",
        body: "Every unheard candidate scores above 0.15, so the recently heard song stays in the queue.",
      },
      {
        title: "Last resort",
        body: "No undelivered candidate is left, so the cooldown gives way and Delivered X returns.",
      },
    ],
  },
] as const satisfies readonly {
  id: RadioState;
  label: string;
  phases: readonly { title: string; body: string }[];
}[];

const PHASE = 2.5;

export const RADIO_TRACKS: Record<RadioState, PhaseTrack> = {
  selector: {
    period: PHASE * 4,
    starts: [0, PHASE, PHASE * 2, PHASE * 3],
    pins: [2.4, PHASE + 2.4, PHASE * 2 + 2.4, PHASE * 3 + 2.4],
  },
};

/** Phase order: delivery and history, each with an alternative and a fallback. */
const CASES = [
  { id: "skip", label: "Same session · refill after a 5 s skip" },
  { id: "listen", label: "Next session · after a 30 s play" },
  { id: "quality", label: "Heard this week · no close alternative" },
  { id: "limited", label: "Small pool · refill after a 5 s skip" },
] as const;

/** Seconds into a phase: the play, the refill, a scan per ranked row, the pick. */
const BEAT = {
  playFrom: 0.05,
  playTo: 0.45,
  decide: 0.55,
  scanFrom: 0.7,
  scanStep: 0.22,
  pick: 0.1,
  queue: 0.2,
};

// ---------------------------------------------------------------------------
// Fixture input (the subset of export_radio_fixture.py's output we read)

export interface FixtureCandidate {
  id: number;
  artist: string;
  title: string;
  key: string[];
  score: number | null;
  status: string;
}

export interface FixtureEvent {
  kind: string;
  bufferIds: number[];
  deliveredKeys: string[][];
  historyKeys: string[][];
  play: {
    seconds: number;
    duration: number;
    threshold: number;
    significant: boolean;
  } | null;
  selectedId: number | null;
  originalWinnerId: number | null;
  qualityLimit: number | null;
  reason: string;
  candidates: FixtureCandidate[];
}

export interface RadioFixture {
  source: { commit: string };
  cases: {
    id: string;
    catalog: { id: number; artist: string; title: string }[];
    events: FixtureEvent[];
  }[];
}

// ---------------------------------------------------------------------------
// Compact script passed to the browser

export type Status =
  | "fresh"
  | "heard"
  | "delivered"
  | "outside"
  | "buffer"
  | "family";

const STATUS: Record<string, Status> = {
  Fresh: "fresh",
  "Heard recently": "heard",
  "Delivered this session": "delivered",
  "Outside quality band": "outside",
  "In buffer": "buffer",
  "Buffered song family": "family",
};

export const STATUS_LABEL: Record<Status, string> = {
  fresh: "fresh",
  heard: "heard · 7 d",
  delivered: "delivered",
  outside: "outside band",
  buffer: "in buffer",
  family: "family in buffer",
};

export type Reason =
  | "ranking"
  | "delivery"
  | "history"
  | "quality-fallback"
  | "delivery-fallback";

export interface ScriptRow {
  id: string;
  title: string;
  key: string;
}

interface Memory {
  /** Row ids in the active buffer. */
  buffer: string[];
  /** Canonical song keys, oldest first. */
  delivered: string[];
  heard: string[];
}

interface Snapshot extends Memory {
  candidates: { row: string; score: number | null; status: Status }[];
}

interface PhaseScript {
  label: string;
  opening: Snapshot;
  play: {
    seconds: number;
    threshold: number;
    duration: number;
    counted: boolean;
  } | null;
  afterPlay: Memory;
  decision: Snapshot;
  best: string;
  selected: string;
  limit: number | null;
  reason: Reason;
  queued: Memory;
}

export interface RadioScript {
  commit: string;
  rows: ScriptRow[];
  chips: { buffer: string[]; delivered: string[]; heard: string[] };
  phases: PhaseScript[];
}

const keyLabel = (key: readonly string[]) => key.join(" · ");

export function buildRadioScript(fixture: RadioFixture): RadioScript {
  const rows = new Map<string, ScriptRow>();
  const chips = {
    buffer: new Set<string>(),
    delivered: new Set<string>(),
    heard: new Set<string>(),
  };

  const phases = CASES.map(({ id, label }) => {
    const story = fixture.cases.find((item) => item.id === id);
    if (!story) throw new Error(`Radio fixture has no "${id}" case`);
    const keys = new Map<string, string>();
    for (const event of story.events)
      for (const candidate of event.candidates)
        keys.set(`${candidate.artist}:${candidate.title}`, keyLabel(candidate.key));

    const rowOf = (artist: string, title: string) => {
      const rowId = `${artist}:${title}`;
      const key = keys.get(rowId);
      if (key === undefined) throw new Error(`No song key for ${rowId}`);
      if (!rows.has(rowId)) rows.set(rowId, { id: rowId, title, key });
      return rowId;
    };
    const catalogRow = (catalogId: number | null) => {
      const entry = story.catalog.find((item) => item.id === catalogId);
      if (!entry) throw new Error(`No catalogue row ${catalogId} in "${id}"`);
      return rowOf(entry.artist, entry.title);
    };
    const memory = (event: FixtureEvent): Memory => {
      const value = {
        buffer: event.bufferIds.map(catalogRow),
        delivered: event.deliveredKeys.map(keyLabel),
        heard: event.historyKeys.map(keyLabel),
      };
      value.buffer.forEach((item) => chips.buffer.add(item));
      value.delivered.forEach((item) => chips.delivered.add(item));
      value.heard.forEach((item) => chips.heard.add(item));
      return value;
    };
    const snapshot = (event: FixtureEvent): Snapshot => ({
      ...memory(event),
      candidates: event.candidates.map((candidate) => {
        const status = STATUS[candidate.status];
        if (!status) throw new Error(`Unknown status ${candidate.status}`);
        return {
          row: rowOf(candidate.artist, candidate.title),
          score: candidate.score,
          status,
        };
      }),
    });

    const events = story.events;
    const last = (kind: string) => {
      const found = events.filter((event) => event.kind === kind).at(-1);
      if (!found) throw new Error(`No "${kind}" event in "${id}"`);
      return found;
    };
    const playIndex = events.findIndex((event) => event.kind === "play");
    const playEvent = playIndex >= 0 ? events[playIndex]! : null;
    const opening = playIndex > 0 ? events[playIndex - 1]! : events[0]!;
    const choose = last("choose");
    const deliver = last("deliver");

    return {
      label,
      opening: snapshot(opening),
      play: playEvent?.play
        ? {
            seconds: playEvent.play.seconds,
            threshold: playEvent.play.threshold,
            duration: playEvent.play.duration,
            counted: playEvent.play.significant,
          }
        : null,
      afterPlay: memory(playEvent ?? opening),
      decision: snapshot(choose),
      best: catalogRow(choose.originalWinnerId),
      selected: catalogRow(choose.selectedId),
      limit: choose.qualityLimit,
      reason: choose.reason as Reason,
      queued: memory(deliver),
    };
  });

  return {
    commit: fixture.source.commit,
    rows: [...rows.values()],
    chips: {
      buffer: [...chips.buffer],
      delivered: [...chips.delivered],
      heard: [...chips.heard],
    },
    phases,
  };
}

// ---------------------------------------------------------------------------
// Frames

export type Tone = "warn" | "ok";
export type Pick = "queued" | "kept" | "returns";

export interface RowFrame {
  id: string;
  title: string;
  key: string;
  visible: boolean;
  slot: number;
  score: number | null;
  status: Status | null;
  /** The status is shown: excluded rows at once, ranked rows once scanned. */
  verdict: boolean;
  /** The best score, which ranking alone would choose. */
  best: boolean;
  pick: Pick | null;
  pickTone: Tone | null;
}

export interface Chip {
  id: string;
  label: string;
  on: boolean;
  order: number;
  tone: "plain" | "hit" | "new";
}

export interface RadioFrame {
  phase: number;
  caseLabel: string;
  rows: RowFrame[];
  /** Slot under the scan cursor, or null before the scan. */
  scan: number | null;
  /** Rows in the pool shown: ranked by score, or excluded by the buffer. */
  pool: { ranked: number; excluded: number };
  /** The ranking has been read and the best score is known. */
  revealed: boolean;
  /** best + 0.05; `applied` is false when the delivery check bypasses it. */
  band: { from: number; to: number; applied: boolean } | null;
  reason: Reason;
  lanes: { buffer: Chip[]; delivered: Chip[]; heard: Chip[] };
  play: {
    seconds: number;
    threshold: number;
    duration: number;
    counted: boolean | null;
  } | null;
}

const PICKS: Record<Reason, Pick> = {
  ranking: "queued",
  delivery: "queued",
  history: "queued",
  "quality-fallback": "kept",
  "delivery-fallback": "returns",
};

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function radioFrame(script: RadioScript, t: number): RadioFrame {
  const track = RADIO_TRACKS.selector;
  const phase = phaseAt(track, t);
  const local = t - track.starts[phase]!;
  const story = script.phases[phase]!;
  const deciding = local >= BEAT.decide;
  const snapshot = deciding ? story.decision : story.opening;
  const ranked = story.decision.candidates.filter((c) => c.score !== null);
  const scanned =
    deciding && local >= BEAT.scanFrom
      ? Math.min(
          ranked.length,
          Math.floor((local - BEAT.scanFrom) / BEAT.scanStep) + 1,
        )
      : 0;
  const pickAt = BEAT.scanFrom + ranked.length * BEAT.scanStep + BEAT.pick;
  const picked = deciding && local >= pickAt;
  const queued = deciding && local >= pickAt + BEAT.queue;
  const played = !story.play || local >= BEAT.playTo;
  const memory = queued
    ? story.queued
    : deciding
      ? story.decision
      : played
        ? story.afterPlay
        : story.opening;
  const previous = queued
    ? story.decision
    : !deciding && played && story.play
      ? story.opening
      : memory;

  const selected = story.decision.candidates.find(
    (c) => c.row === story.selected,
  );
  const pickTone: Tone = selected?.status === "fresh" ? "ok" : "warn";
  const keyOf = (rowId: string) =>
    script.rows.find((row) => row.id === rowId)?.key;

  const rows = script.rows.map((row): RowFrame => {
    const slot = snapshot.candidates.findIndex((c) => c.row === row.id);
    const candidate = snapshot.candidates[slot];
    if (!candidate)
      return {
        ...row,
        visible: false,
        slot: ROW_SLOTS - 1,
        score: null,
        status: null,
        verdict: false,
        best: false,
        pick: null,
        pickTone: null,
      };
    const isPick = picked && row.id === story.selected;
    return {
      ...row,
      visible: true,
      slot,
      score: candidate.score,
      status: candidate.status,
      verdict: candidate.score === null || (deciding && slot < scanned),
      best: deciding && scanned > 0 && row.id === story.best,
      pick: isPick ? PICKS[story.reason] : null,
      pickTone: isPick ? pickTone : null,
    };
  });

  const shown = rows.filter((row) => row.visible && row.verdict);
  const matched = (status: Status[], key: string) =>
    shown.some((row) => status.includes(row.status!) && row.key === key);
  const chips = (
    lane: keyof Memory,
    label: (id: string) => string,
    hit: (id: string) => boolean,
  ): Chip[] =>
    script.chips[lane].map((id) => {
      const order = memory[lane].indexOf(id);
      const on = order >= 0;
      return {
        id,
        label: label(id),
        on,
        order: on ? order : ROW_SLOTS * 4,
        tone: !on
          ? "plain"
          : hit(id)
            ? "hit"
            : !previous[lane].includes(id)
              ? "new"
              : "plain",
      };
    });

  const bestScore =
    story.decision.candidates.find((c) => c.row === story.best)?.score ?? 0;
  const revealed = scanned > 0;
  const band =
    revealed && (story.limit !== null || story.reason === "delivery")
      ? {
          from: bestScore,
          to: story.limit ?? bestScore + QUALITY_BAND,
          applied: story.limit !== null,
        }
      : null;

  const play = story.play
    ? {
        seconds:
          story.play.seconds *
          clamp01((local - BEAT.playFrom) / (BEAT.playTo - BEAT.playFrom)),
        threshold: story.play.threshold,
        duration: story.play.duration,
        counted: played ? story.play.counted : null,
      }
    : null;

  const selectedSlot = snapshot.candidates.findIndex(
    (c) => c.row === story.selected,
  );

  return {
    phase,
    caseLabel: story.label,
    rows,
    scan: !revealed ? null : picked ? selectedSlot : scanned - 1,
    pool: {
      ranked: snapshot.candidates.filter((c) => c.score !== null).length,
      excluded: snapshot.candidates.filter((c) => c.score === null).length,
    },
    revealed,
    band,
    reason: story.reason,
    lanes: {
      buffer: chips(
        "buffer",
        (id) => script.rows.find((row) => row.id === id)?.title ?? id,
        (id) => matched(["buffer", "family"], keyOf(id) ?? ""),
      ),
      delivered: chips(
        "delivered",
        (id) => id,
        (id) => matched(["delivered"], id),
      ),
      heard: chips(
        "heard",
        (id) => id,
        (id) => matched(["heard"], id),
      ),
    },
    play,
  };
}

// ---------------------------------------------------------------------------
// Readouts

export interface Reading {
  text: string;
  note: string;
  tone?: Tone;
}

const score = (value: number | null) => (value ?? 0).toFixed(2);
const DASH: Reading = { text: "—", note: "" };

export function radioReadout(frame: RadioFrame): {
  best: Reading;
  band: Reading;
  play: Reading;
  queued: Reading;
} {
  const best = frame.revealed ? frame.rows.find((row) => row.best) : undefined;
  const pick = frame.rows.find((row) => row.pick);
  const remembered = (row: RowFrame) =>
    row.status === "heard" || row.status === "delivered";

  let band = DASH;
  if (frame.revealed)
    band = frame.band?.applied
      ? {
          text: `≤ ${score(frame.band.to)}`,
          note: `${score(frame.band.from)} + ${score(QUALITY_BAND)}`,
        }
      : {
          text: "Not used",
          note: frame.reason.startsWith("delivery")
            ? "ledger"
            : "best is fresh",
        };

  const play = frame.play;
  return {
    best: best
      ? {
          text: best.title,
          note: score(best.score),
          ...(remembered(best) ? { tone: "warn" as const } : {}),
        }
      : DASH,
    band,
    play: !play
      ? { text: "Earlier", note: `within ${HISTORY_DAYS} days` }
      : play.counted === null
        ? { text: `${Math.round(play.seconds)} s`, note: "playing" }
        : {
            text: `${play.seconds} s`,
            note: play.counted ? "counted" : `under ${play.threshold} s`,
          },
    queued: pick
      ? { text: pick.title, note: score(pick.score), tone: pick.pickTone! }
      : DASH,
  };
}
