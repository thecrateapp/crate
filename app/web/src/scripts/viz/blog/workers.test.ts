import { describe, expect, it } from "vitest";
import {
  ANALYSIS_BATCH_SIZE,
  ANALYSIS_CHECKS,
  activityAt,
  figureTime,
  GOVERNOR,
  LOAD_PAUSE,
  PLAYBACK_PRIORITY,
  REPAIR_CHECKS,
  storyTime,
  WORKERS_STATES,
  WORKERS_TRACKS,
  workersFrame,
  workersReadout,
  type JobId,
  type WorkersFrame,
} from "./workers";

const track = WORKERS_TRACKS.admission;
const pin = (phase: number) => workersFrame(track.pins![phase]!);
const job = (frame: WorkersFrame, id: JobId) =>
  frame.jobs.find((item) => item.id === id)!;
const loop = (step = 0.02) => {
  const frames: WorkersFrame[] = [];
  for (let t = 0; t < track.period; t += step) frames.push(workersFrame(t));
  return frames;
};

describe("workers admission script", () => {
  it("has one phase start and one pin per phase of copy", () => {
    const phases = WORKERS_STATES[0].phases;
    expect(track.starts).toHaveLength(phases.length);
    expect(track.pins).toHaveLength(phases.length);
    expect(track.period).toBeGreaterThanOrEqual(8);
    expect(track.period).toBeLessThanOrEqual(10);
    track.pins!.forEach((value, i) => {
      expect(value).toBeGreaterThanOrEqual(track.starts[i]!);
      expect(value).toBeLessThan(track.starts[i + 1] ?? track.period);
    });
  });

  it("uses the governor constants from 09da2273", () => {
    expect(GOVERNOR).toMatchObject({
      loadRatio: 0.85,
      iowaitPercent: 25,
      swapPercent: 30,
      maxActiveUsers: 0,
      maxActiveStreams: 0,
      usersWindow: 300,
      streamsWindow: 180,
      deferSeconds: 300,
    });
    expect(LOAD_PAUSE).toBe(60);
    expect(ANALYSIS_BATCH_SIZE).toBe(8);
    expect(PLAYBACK_PRIORITY).toBe(0);
  });

  it("maps figure time to story time monotonically and back", () => {
    let last = -Infinity;
    for (let t = 0; t <= track.period; t += 0.05) {
      const s = storyTime(t);
      expect(s).toBeGreaterThanOrEqual(last);
      expect(figureTime(s)).toBeCloseTo(t, 6);
      last = s;
    }
  });

  it("counts play events by ended_at inside the 5 and 3 minute windows", () => {
    expect(activityAt(150)).toEqual({ users: 0, streams: 0 });
    expect(activityAt(200)).toEqual({ users: 1, streams: 1 });
    // The first play leaves the 3-minute window before the second one ends.
    expect(activityAt(390)).toEqual({ users: 1, streams: 0 });
    expect(activityAt(420)).toEqual({ users: 1, streams: 1 });
    expect(activityAt(600)).toEqual({ users: 1, streams: 0 });
    expect(activityAt(711)).toEqual({ users: 0, streams: 0 });
  });

  it("re-sends the repair every 300 s until the windows are empty", () => {
    expect(REPAIR_CHECKS).toEqual([
      { at: 240, allowed: false },
      { at: 540, allowed: false },
      { at: 840, allowed: true },
    ]);
    const gaps = REPAIR_CHECKS.slice(1).map(
      (check, i) => check.at - REPAIR_CHECKS[i]!.at,
    );
    expect(gaps.every((gap) => gap === GOVERNOR.deferSeconds)).toBe(true);
  });

  it("has the analysis loop sleep 60 s between checks before claiming", () => {
    expect(ANALYSIS_CHECKS[0]!.at).toBe(225);
    expect(ANALYSIS_CHECKS.at(-1)).toEqual({ at: 765, allowed: true });
    expect(ANALYSIS_CHECKS.slice(0, -1).every((check) => !check.allowed)).toBe(
      true,
    );
    ANALYSIS_CHECKS.slice(1).forEach((check, i) =>
      expect(check.at - ANALYSIS_CHECKS[i]!.at).toBe(LOAD_PAUSE),
    );
  });

  it("Play: playback prepares in its own slot before any play event exists", () => {
    const frame = pin(0);
    expect(frame.activity).toMatchObject({ users: 0, streams: 0, listening: true });
    expect(frame.decision.allowed).toBe(true);
    expect(job(frame, "variant-a")).toMatchObject({ state: "preparing", zone: "slot" });
    expect(job(frame, "repair-running")).toMatchObject({ state: "running", zone: "slot" });
    expect(job(frame, "batch-claimed")).toMatchObject({ state: "running", zone: "slot" });
    expect(job(frame, "repair-next")).toMatchObject({ state: "queued", zone: "waiting" });
    expect(workersReadout(frame).playback).toMatchObject({ text: "Preparing" });
  });

  it("Defer: the next repair goes back with the same task and a 300 s delay", () => {
    const frame = pin(1);
    expect(frame.activity).toMatchObject({ users: 1, streams: 1 });
    expect(frame.decision).toEqual({
      allowed: false,
      reason: "1 active listener(s)>0, 1 recent stream(s)>0",
    });
    const repair = job(frame, "repair-next");
    expect(repair.state).toBe("deferred");
    expect(repair.delay).toBeGreaterThan(290);
    expect(repair.delay).toBeLessThanOrEqual(GOVERNOR.deferSeconds);
    expect(frame.lanes.maintenance).toMatchObject({ busy: false, deferrals: 1, done: 1 });
    // Analysis finished its admitted batch, then left the next 8 rows unclaimed.
    expect(job(frame, "batch-claimed").state).toBe("done");
    expect(job(frame, "batch-next")).toMatchObject({ state: "pending", zone: "waiting" });
    expect(frame.lanes.analysis).toMatchObject({ sleeping: true, stored: ANALYSIS_BATCH_SIZE });
    expect(workersReadout(frame)).toMatchObject({
      governor: { text: "Defer", tone: "warn" },
      repair: { text: "Pending", tone: "warn" },
    });
  });

  it("Hold: the slot stays free and a recent play sends the task back again", () => {
    const frame = pin(2);
    expect(frame.activity.listening).toBe(false);
    expect(frame.activity.users).toBe(1);
    expect(frame.decision.allowed).toBe(false);
    expect(job(frame, "repair-next").state).toBe("deferred");
    expect(frame.lanes.maintenance).toMatchObject({ busy: false, deferrals: 2 });
    expect(frame.lanes.analysis.sleeping).toBe(true);
    expect(frame.lanes.analysis.checks).toBeGreaterThan(3);
  });

  it("Retry: with both windows empty the same repair task runs", () => {
    const frame = pin(3);
    expect(frame.activity).toMatchObject({ users: 0, streams: 0, listening: false });
    expect(frame.decision).toEqual({ allowed: true, reason: "" });
    expect(job(frame, "repair-next")).toMatchObject({ state: "running", zone: "slot" });
    expect(job(frame, "batch-next")).toMatchObject({ state: "running", zone: "slot" });
    expect(frame.lanes.maintenance).toMatchObject({ busy: true, deferrals: 2 });
    expect(workersReadout(frame)).toMatchObject({
      governor: { text: "Allow", tone: "ok" },
      repair: { text: "Running", tone: "ok" },
      interrupted: { text: "None" },
    });
  });

  it("never interrupts admitted work", () => {
    let repairProgress = 0;
    let cells = 0;
    for (const frame of loop()) {
      const repair = job(frame, "repair-running");
      const batch = job(frame, "batch-claimed");
      expect(["running", "done"]).toContain(repair.state);
      expect(["running", "done"]).toContain(batch.state);
      expect(repair.progress).toBeGreaterThanOrEqual(repairProgress);
      expect(batch.cells).toBeGreaterThanOrEqual(cells);
      repairProgress = repair.progress;
      cells = batch.cells;
      expect(workersReadout(frame).interrupted.text).toBe("None");
    }
    expect(repairProgress).toBe(1);
    expect(cells).toBe(ANALYSIS_BATCH_SIZE);
  });

  it("never stops playback preparation at a gate", () => {
    for (const frame of loop()) {
      for (const id of ["variant-a", "variant-b"] as const) {
        const variant = job(frame, id);
        expect(["deferred", "checking"]).not.toContain(variant.state);
      }
      expect(frame.lanes.playback.governed).toBe(false);
    }
  });

  it("keeps the sampled gauges under their limits, so plays are the reason", () => {
    for (const frame of loop()) {
      expect(frame.gauges.loadRatio).toBeLessThan(GOVERNOR.loadRatio);
      expect(frame.gauges.iowaitPercent).toBeLessThan(GOVERNOR.iowaitPercent);
      expect(frame.gauges.swapPercent).toBeLessThan(GOVERNOR.swapPercent);
      const listening = frame.activity.users > 0 || frame.activity.streams > 0;
      expect(frame.decision.allowed).toBe(!listening);
    }
  });

  it("ends the track on the admitted retry for reduced motion", () => {
    const frame = workersFrame(track.period - 0.001);
    expect(job(frame, "repair-next").state).toBe("running");
    expect(frame.decision.allowed).toBe(true);
  });
});
