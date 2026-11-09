/**
 * Time model shared by blog figures: a figure loops through numbered phases,
 * a reader can pin one phase to study it, and a switch selects another track
 * (for example the "before" and "after" versions of the same mechanism).
 */

export interface PhaseTrack {
  /** Loop length in seconds, including any hold after the last phase. */
  period: number;
  /** Start time of each phase in seconds; the first is 0. */
  starts: readonly number[];
  /** Optional moment shown when a phase is pinned; defaults to its end. */
  pins?: readonly (number | undefined)[];
}

const REST = 0.001;

export function phaseAt(track: PhaseTrack, t: number): number {
  let phase = 0;
  track.starts.forEach((start, i) => {
    if (t >= start) phase = i;
  });
  return phase;
}

const phaseEnd = (track: PhaseTrack, phase: number) =>
  track.starts[phase + 1] ?? track.period;

export function phaseProgress(track: PhaseTrack, t: number): number {
  const phase = phaseAt(track, t);
  const start = track.starts[phase] ?? 0;
  const span = phaseEnd(track, phase) - start;
  return span > 0 ? Math.min(1, Math.max(0, (t - start) / span)) : 1;
}

/** The time shown while a phase is pinned: its pin, or just before it ends. */
export function restTime(track: PhaseTrack, phase: number): number {
  return track.pins?.[phase] ?? phaseEnd(track, phase) - REST;
}

export interface PhaseClock {
  readonly state: string;
  readonly track: PhaseTrack;
  readonly time: number;
  readonly phase: number;
  readonly progress: number;
  readonly pinned: number | null;
  advance(dt: number): void;
  /** Pins a phase; pinning the pinned phase again resumes the loop. */
  pin(phase: number): void;
  select(state: string): void;
}

export function createPhaseClock(
  tracks: Readonly<Record<string, PhaseTrack>>,
  initial: string,
  { still = false }: { still?: boolean } = {},
): PhaseClock {
  let state = initial;
  let time = 0;
  let pinned: number | null = null;
  const current = () => tracks[state]!;
  const last = () => current().starts.length - 1;
  const settle = () => {
    if (pinned !== null) time = restTime(current(), pinned);
    else if (still) time = current().period - REST;
  };
  settle();

  return {
    get state() {
      return state;
    },
    get track() {
      return current();
    },
    get time() {
      return time;
    },
    get phase() {
      return phaseAt(current(), time);
    },
    get progress() {
      return phaseProgress(current(), time);
    },
    get pinned() {
      return pinned;
    },
    advance(dt) {
      if (pinned !== null || still) return;
      time = (time + dt) % current().period;
    },
    pin(phase) {
      if (phase < 0 || phase > last()) return;
      pinned = pinned === phase ? null : phase;
      settle();
    },
    select(next) {
      if (!tracks[next] || next === state) return;
      state = next;
      pinned = null;
      time = 0;
      settle();
    },
  };
}
