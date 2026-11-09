import { describe, expect, it } from "vitest";
import {
  beatOffset,
  CROSSFADE_STATES,
  CROSSFADE_TRACKS,
  crossfadeReadout,
  FADE,
  gains,
  STAGING,
  STALL,
  storyTime,
} from "./crossfade";

describe("crossfade figure model", () => {
  it("has one phase start per phase of copy", () => {
    for (const state of CROSSFADE_STATES)
      expect(CROSSFADE_TRACKS[state.id]!.starts).toHaveLength(
        state.phases.length,
      );
  });

  it("holds both timer gains while the UI thread is busy, then jumps", () => {
    const start = gains("timer", STALL.from);
    const held = gains("timer", STALL.to - 0.01);
    expect(held.a).toBeCloseTo(start.a);
    expect(held.b).toBeCloseTo(start.b);
    const after = gains("timer", STALL.to);
    expect(after.a).toBeLessThan(held.a - 0.1);
  });

  it("keeps the timer's incoming staging until the end, then steps to unity", () => {
    const beforeEnd = gains("timer", FADE - 0.01);
    expect(beforeEnd.b).toBeCloseTo(STAGING, 2);
    expect(gains("timer", FADE).b).toBe(1);
  });

  it("follows the samples through the stall and eases staging back without a step", () => {
    const start = gains("pcm", STALL.from);
    const later = gains("pcm", STALL.to - 0.01);
    expect(later.a).toBeLessThan(start.a - 0.1);
    expect(gains("pcm", FADE - 0.01).b).toBeCloseTo(1, 2);
    expect(gains("pcm", FADE / 2).b).toBeCloseTo(Math.SQRT1_2 * STAGING, 3);
  });

  it("aligns the incoming beats only on the shared bus", () => {
    expect(beatOffset("timer")).toBeGreaterThan(0);
    expect(beatOffset("pcm")).toBe(beatOffset("timer"));
    expect(beatOffset("bus")).toBe(0);
  });

  it("maps figure time onto the transition and holds the end", () => {
    expect(storyTime(0)).toBeLessThan(0);
    expect(storyTime(9.9)).toBe(storyTime(9));
  });

  it("reports the stalled UI thread and the step in the readout", () => {
    const stalled = crossfadeReadout("timer", (STALL.from + STALL.to) / 2);
    expect(stalled.ui).toEqual({ text: "Busy", tone: "warn" });
    expect(crossfadeReadout("pcm", (STALL.from + STALL.to) / 2).ui.tone).toBe(
      "warn",
    );
    expect(crossfadeReadout("bus", 1).beats).toEqual({
      text: "Aligned",
      tone: "ok",
    });
    expect(crossfadeReadout("timer", 1).output).toBe("2 players");
    expect(crossfadeReadout("bus", 1).output).toBe("1 bus");
  });
});
