import { describe, expect, it } from "vitest";
import {
  createPhaseClock,
  phaseAt,
  phaseProgress,
  restTime,
  type PhaseTrack,
} from "./phase-clock";

const track: PhaseTrack = { period: 10, starts: [0, 2, 5, 8] };
const tracks = { before: track, after: { period: 6, starts: [0, 3] } };

describe("phase track", () => {
  it("finds the phase that contains a time", () => {
    expect(phaseAt(track, 0)).toBe(0);
    expect(phaseAt(track, 1.99)).toBe(0);
    expect(phaseAt(track, 2)).toBe(1);
    expect(phaseAt(track, 7.5)).toBe(2);
    expect(phaseAt(track, 9.9)).toBe(3);
  });

  it("reports progress through the current phase, ending at the period", () => {
    expect(phaseProgress(track, 2)).toBe(0);
    expect(phaseProgress(track, 3.5)).toBeCloseTo(0.5);
    expect(phaseProgress(track, 9)).toBeCloseTo(0.5);
  });

  it("rests at a chosen moment when the track names one", () => {
    const pinned: PhaseTrack = { ...track, pins: [1, 3.5, undefined, 9] };
    expect(restTime(pinned, 0)).toBe(1);
    expect(restTime(pinned, 1)).toBe(3.5);
    expect(restTime(pinned, 2)).toBeCloseTo(8);
    expect(restTime(pinned, 3)).toBe(9);
  });

  it("rests at the end of a phase so its result is visible", () => {
    expect(restTime(track, 0)).toBeLessThan(2);
    expect(restTime(track, 0)).toBeGreaterThan(1.99);
    expect(phaseAt(track, restTime(track, 1))).toBe(1);
    expect(restTime(track, 3)).toBeLessThan(10);
    expect(phaseAt(track, restTime(track, 3))).toBe(3);
  });
});

describe("phase clock", () => {
  it("loops through the selected track", () => {
    const clock = createPhaseClock(tracks, "before");
    clock.advance(4);
    expect(clock.phase).toBe(1);
    clock.advance(7);
    expect(clock.time).toBeCloseTo(1);
    expect(clock.phase).toBe(0);
  });

  it("pins a phase, holds it while time passes and resumes from it", () => {
    const clock = createPhaseClock(tracks, "before");
    clock.pin(2);
    expect(clock.pinned).toBe(2);
    expect(clock.phase).toBe(2);
    clock.advance(3);
    expect(clock.phase).toBe(2);
    expect(clock.time).toBeCloseTo(restTime(track, 2));
    clock.pin(2);
    expect(clock.pinned).toBeNull();
    clock.advance(0.5);
    expect(clock.phase).toBe(3);
  });

  it("moves a pin to another phase", () => {
    const clock = createPhaseClock(tracks, "before");
    clock.pin(1);
    clock.pin(3);
    expect(clock.pinned).toBe(3);
    expect(clock.phase).toBe(3);
  });

  it("restarts the new track when the state changes", () => {
    const clock = createPhaseClock(tracks, "before");
    clock.advance(6);
    clock.pin(3);
    clock.select("after");
    expect(clock.state).toBe("after");
    expect(clock.time).toBe(0);
    expect(clock.pinned).toBeNull();
    clock.advance(4);
    expect(clock.phase).toBe(1);
  });

  it("ignores unknown states and phases", () => {
    const clock = createPhaseClock(tracks, "before");
    clock.select("missing");
    clock.pin(9);
    expect(clock.state).toBe("before");
    expect(clock.pinned).toBeNull();
  });

  it("shows the end of the track, not a pin, when motion is reduced", () => {
    const pinned = { before: { ...track, pins: [1, 3, 6, 8.5] } };
    const clock = createPhaseClock(pinned, "before", { still: true });
    expect(clock.time).toBeCloseTo(10, 2);
    clock.pin(3);
    expect(clock.time).toBe(8.5);
  });

  it("shows the final phase without moving when motion is reduced", () => {
    const clock = createPhaseClock(tracks, "before", { still: true });
    expect(clock.phase).toBe(3);
    clock.advance(4);
    expect(clock.phase).toBe(3);
    clock.pin(1);
    expect(clock.phase).toBe(1);
    clock.pin(1);
    expect(clock.phase).toBe(3);
    clock.select("after");
    expect(clock.phase).toBe(1);
  });
});
