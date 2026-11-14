/**
 * Gapless-5 reports the position every ~27 ms. Committing each tick to React
 * re-rendered the player provider ~37 times a second. Engine ticks now go
 * through this committer: the exact time always lands in the caller's ref, and
 * React state follows at most every `intervalMs`, plus immediately whenever the
 * whole second changes, so time labels and the floored media-session/MPRIS
 * position flip on the same tick as before. Seeks, restores and remote
 * positions keep using `commitNow`.
 */
export const PLAYBACK_TICK_COMMIT_INTERVAL_MS = 250;
export const PLAYBACK_HIDDEN_COMMIT_INTERVAL_MS = 1_000;

export interface TickTimeCommitter {
  /** An engine progress tick: commit if the second changed, else coalesce. */
  tick(time: number): void;
  /** A discrete position change (seek, restore, reset): commit right away. */
  commitNow(time: number): void;
  /** Drop a pending trailing commit. The committer stays usable. */
  dispose(): void;
}

export interface TickTimeCommitterOptions {
  commit: (time: number) => void;
  /** Latest exact time, read when a coalesced commit fires. */
  read: () => number;
  intervalMs?: number;
  /**
   * While true (the desktop window is on no monitor) the trailing commit waits
   * `hiddenIntervalMs`: nothing is drawn, so second changes are enough, and the
   * trailing commit still lands the exact time after a pause.
   */
  isHidden?: () => boolean;
  hiddenIntervalMs?: number;
  now?: () => number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export function createTickTimeCommitter({
  commit,
  read,
  intervalMs = PLAYBACK_TICK_COMMIT_INTERVAL_MS,
  isHidden = () => false,
  hiddenIntervalMs = PLAYBACK_HIDDEN_COMMIT_INTERVAL_MS,
  now = () => performance.now(),
  setTimer = (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer = (handle) =>
    clearTimeout(handle as ReturnType<typeof setTimeout>),
}: TickTimeCommitterOptions): TickTimeCommitter {
  let lastCommitted: number | null = null;
  let lastCommitAt = 0;
  let timer: unknown = null;

  const cancelTimer = () => {
    if (timer === null) return;
    clearTimer(timer);
    timer = null;
  };
  const apply = (time: number) => {
    lastCommitted = time;
    lastCommitAt = now();
    commit(time);
  };
  const flush = () => {
    timer = null;
    const time = read();
    if (time !== lastCommitted) apply(time);
  };

  return {
    tick(time) {
      if (
        lastCommitted === null ||
        Math.floor(time) !== Math.floor(lastCommitted)
      ) {
        cancelTimer();
        apply(time);
        return;
      }
      if (timer !== null || time === lastCommitted) return;
      const interval = isHidden() ? hiddenIntervalMs : intervalMs;
      timer = setTimer(flush, Math.max(0, interval - (now() - lastCommitAt)));
    },
    commitNow(time) {
      cancelTimer();
      apply(time);
    },
    dispose() {
      cancelTimer();
    },
  };
}
