import type { PhaseTrack } from "./phase-clock";

/**
 * H11 figure: the anchor-first Music Paths builder of f602d82d on the three
 * regression fixtures exported by scripts/export_music_path_fixture.py. The
 * export runs the pinned compute_path, candidate selection and song identity on
 * the synthetic catalogues of app/tests/test_music_paths_fallback.py; every
 * retrieved, skipped and selected row here comes from it. This module never
 * imports the JSON: the component converts it with pathLanes() on the server
 * and passes the client only the compact lanes. The horizontal axis is
 * compute_path's `global_step / (step_count - 1)`, not acoustic distance; the
 * timing is illustrative.
 */

export type MusicPathsState = "anchor-first";

export const VIEW = { width: 720, height: 380 };
export const X0 = 40;
export const X1 = 680;
const LANE_TOPS = [6, 126, 246] as const;
const LANE = { tag: 12, hover: 42, route: 68, label: 84 } as const;

export const laneY = (lane: number, part: keyof typeof LANE) =>
  (LANE_TOPS[lane] ?? 0) + LANE[part];

/** x of a requested step: the builder's progress through the route. */
export const slotX = (step: number, requested: number) =>
  X0 + (step / Math.max(1, requested - 1)) * (X1 - X0);

export const MUSIC_PATHS_STATES = [
  {
    id: "anchor-first",
    label: "Anchor-first",
    phases: [
      {
        title: "Reserve",
        body: "Both anchors resolve first. The destination's ID, title key and song family join the used sets before step 1.",
      },
      {
        title: "Skip versions",
        body: "Each middle step skips used IDs, titles and song families, so the destination's live version is passed over.",
      },
      {
        title: "Run out",
        body: "With no eligible row left, a requested step stays empty. The sparse catalogue leaves 18 of them.",
      },
      {
        title: "Append",
        body: "The reserved destination closes each route: 5 of 5, 3 of 5 and 2 of 20 tracks.",
      },
    ],
  },
] as const satisfies readonly {
  id: MusicPathsState;
  label: string;
  phases: readonly { title: string; body: string }[];
}[];

export const TIMES = {
  origin: 0.35,
  reserve: 0.95,
  sweep: [2, 7.4] as const,
  append: 7.8,
};

export const MUSIC_PATHS_TRACKS: Record<MusicPathsState, PhaseTrack> = {
  "anchor-first": {
    period: 10,
    starts: [0, 2, 3.9, 7.5],
    pins: [1.7, 3.1, 7.3, 9],
  },
};

/** The moment a middle step's selection resolves, aligned by progress. */
export const attemptTime = (step: number, requested: number) =>
  TIMES.sweep[0] +
  (step / Math.max(1, requested - 1)) * (TIMES.sweep[1] - TIMES.sweep[0]);

/** Candidates hover over a step this long before it resolves. */
const LEAD = 0.8;
/** Selected and skipped rows are marked this long before it resolves. */
const DECIDE = 0.5;
const HOP = 0.3;

// The subset of blog-music-path-fixture.json that the figure reads.
export interface FixtureCase {
  id: string;
  label: string;
  requested: number;
  originId: number;
  destinationId: number;
  catalog: readonly { id: number; title: string; family: readonly string[] }[];
  attempts: readonly {
    step: number;
    retrievedIds: readonly number[];
    familyExcludedIds: readonly number[];
    selectedId: number | null;
  }[];
  events: readonly { candidates: readonly { id: number }[] }[];
}

export interface PathLane {
  id: string;
  label: string;
  requested: number;
  origin: number;
  destination: number;
  /**
   * Rows the fixture's candidate retrieval can return, destination included.
   * `family` marks another version of the destination: same song identity.
   */
  pool: { id: number; label: string; family: boolean }[];
  attempts: {
    step: number;
    retrieved: number[];
    family: number[];
    selected: number | null;
  }[];
  /** Slot labels: the ID, plus the title when another version is in the pool. */
  names: Record<number, string>;
}

export function pathLanes(fixture: {
  cases: readonly FixtureCase[];
}): PathLane[] {
  return fixture.cases.map((item) => {
    const family = (id: number) =>
      item.catalog.find((row) => row.id === id)?.family.join("\u0000") ?? "";
    const title = (id: number) =>
      item.catalog.find((row) => row.id === id)?.title ?? "";
    const poolIds = [
      ...new Set(item.events.flatMap((event) => event.candidates.map((row) => row.id))),
    ];
    const versioned = (id: number) =>
      item.catalog.some((row) => row.id !== id && family(row.id) === family(id));
    const name = (id: number) => (versioned(id) ? `#${id} ${title(id)}` : `#${id}`);
    const names: Record<number, string> = {};
    for (const row of item.catalog) names[row.id] = name(row.id);
    return {
      id: item.id,
      label: item.label,
      requested: item.requested,
      origin: item.originId,
      destination: item.destinationId,
      pool: poolIds.map((id) => ({
        id,
        label: name(id),
        family: id !== item.destinationId && family(id) === family(item.destinationId),
      })),
      attempts: item.attempts.map((attempt) => ({
        step: attempt.step,
        retrieved: [...attempt.retrievedIds],
        family: [...attempt.familyExcludedIds],
        selected: attempt.selectedId,
      })),
      names,
    };
  });
}

export type SlotState = "todo" | "filled" | "empty";
export type PillState = "hidden" | "candidate" | "selected" | "excluded" | "landed";
export type ChipState = "idle" | "reserved" | "selected" | "excluded" | "appended";

export interface LaneFrame {
  origin: "pending" | "appended";
  destination: "pending" | "reserved" | "appended";
  /** Middle steps 1 … requested − 2, in order. */
  slots: SlotState[];
  /** One entry per pool row; `order` places the selected row first. */
  pills: { id: number; state: PillState; order: number }[];
  /** Where the hovering candidates sit, and the width of the first in ch. */
  group: { x: number; lead: number } | null;
  /** x of the step whose selected row is dropping into its slot. */
  drop: number | null;
  route: string;
  chips: { id: number; state: ChipState }[];
  count: number;
  empty: number;
}

export interface PathsFrame {
  /** x of the step being searched, or null outside the sweep. */
  sweep: number | null;
  lanes: LaneFrame[];
}

const ease = (k: number) => {
  const t = Math.min(1, Math.max(0, k));
  return t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
};

export const pillWidth = (label: string) => label.length + 2;

function laneFrame(lane: PathLane, index: number, t: number): LaneFrame {
  const { requested } = lane;
  const times = lane.attempts.map((attempt) => attemptTime(attempt.step, requested));
  const origin = t >= TIMES.origin ? "appended" : "pending";
  const destination =
    t >= TIMES.append ? "appended" : t >= TIMES.reserve ? "reserved" : "pending";
  const slots: SlotState[] = Array.from({ length: Math.max(0, requested - 2) }, () => "todo");
  lane.attempts.forEach((attempt, i) => {
    if (t >= times[i]!) slots[attempt.step - 1] = attempt.selected === null ? "empty" : "filled";
  });

  // The attempt whose candidates are on screen: windows run back to back.
  const active = lane.attempts.findIndex((_, i) => {
    const start = times[i]! - LEAD;
    const end = i + 1 < times.length ? times[i + 1]! - LEAD : TIMES.sweep[1];
    return t >= start && t < end;
  });
  const attempt = active >= 0 ? lane.attempts[active]! : null;
  const decided = attempt ? t >= times[active]! - DECIDE : false;
  const landed = attempt ? t >= times[active]! : false;
  const members = attempt
    ? [
        ...(attempt.selected !== null ? [attempt.selected] : []),
        ...attempt.retrieved.filter((id) => id !== attempt.selected),
      ]
    : [];
  const pills = lane.pool.map(({ id }) => {
    const order = members.indexOf(id);
    let state: PillState = "hidden";
    if (attempt && order >= 0) {
      if (id === attempt.selected) state = landed ? "landed" : decided ? "selected" : "candidate";
      else if (decided && attempt.family.includes(id)) state = "excluded";
      else state = "candidate";
    }
    return { id, state, order: Math.max(0, order) };
  });

  let group: LaneFrame["group"] = null;
  if (attempt && members.length) {
    const x = slotX(attempt.step, requested);
    const previous = active > 0 ? lane.attempts[active - 1]! : null;
    const from = previous && previous.retrieved.length ? slotX(previous.step, requested) : x;
    const k = ease((t - (times[active]! - LEAD)) / HOP);
    const lead = lane.pool.find((row) => row.id === members[0])!.label;
    group = { x: from + (x - from) * k, lead: pillWidth(lead) };
  }

  const drop =
    attempt && attempt.selected !== null && decided && !landed
      ? slotX(attempt.step, requested)
      : null;

  const steps = [
    ...(origin === "appended" ? [0] : []),
    ...slots.flatMap((slot, i) => (slot === "filled" ? [i + 1] : [])),
    ...(destination === "appended" ? [requested - 1] : []),
  ];
  const y = laneY(index, "route");
  const route =
    steps.length > 1
      ? steps.map((step, i) => `${i ? "L" : "M"}${slotX(step, requested)} ${y}`).join(" ")
      : "";

  // A row is ineligible from the moment its ID or song family is reserved.
  const chips = lane.pool.map(({ id, family }) => {
    let state: ChipState = "idle";
    if (id === lane.destination)
      state = destination === "pending" ? "idle" : destination;
    else if (lane.attempts.some((item, i) => item.selected === id && t >= times[i]!))
      state = "selected";
    else if (family && destination !== "pending") state = "excluded";
    return { id, state };
  });

  const filled = slots.filter((slot) => slot === "filled").length;
  return {
    origin,
    destination,
    slots,
    pills,
    group,
    drop,
    route,
    chips,
    count: (origin === "appended" ? 1 : 0) + filled + (destination === "appended" ? 1 : 0),
    empty: slots.filter((slot) => slot === "empty").length,
  };
}

export function pathsFrame(lanes: readonly PathLane[], t: number): PathsFrame {
  const [from, to] = TIMES.sweep;
  return {
    sweep: t >= from && t < to ? X0 + ((t - from) / (to - from)) * (X1 - X0) : null,
    lanes: lanes.map((lane, index) => laneFrame(lane, index, t)),
  };
}

type Tone = "warn" | "ok" | undefined;

export function pathsReadout(
  lanes: readonly PathLane[],
  frame: PathsFrame,
): {
  lanes: { text: string; empty: number; tone: Tone }[];
  destination: { text: string; tone: Tone };
} {
  const destination = frame.lanes[0]?.destination ?? "pending";
  return {
    lanes: frame.lanes.map((state, i) => {
      const requested = lanes[i]!.requested;
      const tone: Tone =
        state.count === requested ? "ok" : state.empty > 0 ? "warn" : undefined;
      return { text: `${state.count} / ${requested}`, empty: state.empty, tone };
    }),
    destination:
      destination === "appended"
        ? { text: "Appended", tone: "ok" }
        : destination === "reserved"
          ? { text: "Reserved", tone: "ok" }
          : { text: "Pending", tone: undefined },
  };
}
