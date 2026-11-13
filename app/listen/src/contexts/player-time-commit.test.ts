import { describe, expect, it, vi } from "vitest";

import {
  createTickTimeCommitter,
  PLAYBACK_TICK_COMMIT_INTERVAL_MS,
} from "./player-time-commit";

/** A committer on a fake clock, fed like Gapless-5 does (one tick per 27 ms). */
function harness(intervalMs = PLAYBACK_TICK_COMMIT_INTERVAL_MS) {
  let clock = 0;
  let exact = 0;
  const timers = new Map<number, { at: number; callback: () => void }>();
  let nextTimer = 1;
  const commit = vi.fn();
  const committer = createTickTimeCommitter({
    commit,
    read: () => exact,
    intervalMs,
    now: () => clock,
    setTimer: (callback, delayMs) => {
      const id = nextTimer++;
      timers.set(id, { at: clock + delayMs, callback });
      return id;
    },
    clearTimer: (id) => timers.delete(id as number),
  });
  const advance = (ms: number) => {
    const until = clock + ms;
    for (;;) {
      const due = [...timers.entries()]
        .filter(([, timer]) => timer.at <= until)
        .sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      clock = due[1].at;
      due[1].callback();
    }
    clock = until;
  };
  return {
    commit,
    committer,
    pendingTimers: () => timers.size,
    advance,
    /** One engine tick: the caller's ref gets the exact time first. */
    tick(time: number) {
      exact = time;
      committer.tick(time);
    },
    seek(time: number) {
      exact = time;
      committer.commitNow(time);
    },
  };
}

describe("createTickTimeCommitter", () => {
  it("commits about 4 times a second instead of on every 27 ms tick", () => {
    const h = harness();
    // 10 s of playback starting mid-second, so second flips are not aligned.
    for (let ms = 0; ms <= 10_000; ms += 27) {
      h.tick(0.4 + ms / 1000);
      h.advance(27);
    }

    const ticks = Math.floor(10_000 / 27) + 1;
    expect(ticks).toBeGreaterThan(360);
    // 4 Hz plus up to one extra commit per second boundary.
    expect(h.commit.mock.calls.length).toBeLessThanOrEqual(10 * 5 + 2);
    expect(h.commit.mock.calls.length).toBeGreaterThanOrEqual(10 * 4 - 2);
  });

  it("commits on the very tick the displayed second changes", () => {
    const h = harness();
    h.tick(4.95);
    h.commit.mockClear();

    h.tick(4.98);
    expect(h.commit).not.toHaveBeenCalled();
    h.tick(5.007);
    expect(h.commit).toHaveBeenLastCalledWith(5.007);
  });

  it("flushes the latest exact time when no new second arrives", () => {
    const h = harness();
    h.tick(10.1);
    h.tick(10.13);
    h.tick(10.16);
    expect(h.commit).toHaveBeenCalledTimes(1);

    h.advance(PLAYBACK_TICK_COMMIT_INTERVAL_MS);

    expect(h.commit).toHaveBeenLastCalledWith(10.16);
    expect(h.pendingTimers()).toBe(0);
  });

  it("lands the final position after playback pauses mid-second", () => {
    const h = harness();
    h.tick(20.2);
    h.tick(20.23);
    // Pause: no more ticks arrive.
    h.advance(1_000);

    expect(h.commit).toHaveBeenLastCalledWith(20.23);
  });

  it("commits seeks immediately and drops the stale trailing commit", () => {
    const h = harness();
    h.tick(30.1);
    h.tick(30.13);
    expect(h.pendingTimers()).toBe(1);

    h.seek(30.5);
    expect(h.commit).toHaveBeenLastCalledWith(30.5);
    expect(h.pendingTimers()).toBe(0);

    h.advance(1_000);
    expect(h.commit).toHaveBeenLastCalledWith(30.5);
  });

  it("commits a backwards seek within the same second", () => {
    const h = harness();
    h.tick(40.9);
    h.seek(40.1);

    expect(h.commit).toHaveBeenLastCalledWith(40.1);
  });

  it("dispose cancels a pending commit but keeps working", () => {
    const h = harness();
    h.tick(50.1);
    h.tick(50.2);
    h.committer.dispose();
    h.advance(1_000);
    expect(h.commit).toHaveBeenCalledTimes(1);

    h.tick(51.0);
    expect(h.commit).toHaveBeenLastCalledWith(51.0);
  });
});
