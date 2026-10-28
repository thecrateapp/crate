import { describe, expect, it } from "vitest";
import {
  easeInOut,
  equalPower,
  incomingBeats,
  incomingTempo,
  isDownbeat,
  lowsCut,
  mixSeconds,
  outgoingBeats,
  pulse,
  storyAt,
  storyWindow,
  swapProgress,
  waveLevels,
  type MixPlan,
} from "./mix-math";

const plan: MixPlan = {
  outgoingBpm: 124,
  incomingBpm: 120,
  beats: 12,
  prerollS: 2.5,
  restoreS: 4,
  swapFraction: 0.125,
  cutDb: -24,
};
const beat = 60 / plan.outgoingBpm;
const length = mixSeconds(plan);

describe("equalPower", () => {
  it("keeps constant power across the fade", () => {
    for (const t of [0, 0.1, 0.25, 0.5, 0.8, 1]) {
      const { out, in: incoming } = equalPower(t);
      expect(out ** 2 + incoming ** 2).toBeCloseTo(1, 6);
    }
    expect(equalPower(0)).toEqual({ out: 1, in: 0 });
    expect(equalPower(0.5).out).toBeCloseTo(Math.SQRT1_2, 6);
    expect(equalPower(3).in).toBe(1);
  });
});

describe("easeInOut", () => {
  it("runs from 0 to 1 through the midpoint and clamps outside", () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 6);
    expect(easeInOut(2)).toBe(1);
  });
});

describe("mixSeconds", () => {
  it("measures the blend in beats of the outgoing tempo", () => {
    expect(length).toBeCloseTo(12 * beat, 9);
  });
});

describe("incomingTempo", () => {
  it("plays the incoming track at the outgoing tempo from pre-roll to the end of the blend", () => {
    expect(incomingTempo(plan, -3)).toBe(120);
    expect(incomingTempo(plan, -2.5)).toBe(124);
    expect(incomingTempo(plan, length)).toBe(124);
  });

  it("eases back to its own tempo over the restore time", () => {
    expect(incomingTempo(plan, length + 2)).toBeCloseTo(122, 6);
    expect(incomingTempo(plan, length + 4)).toBe(120);
    expect(incomingTempo(plan, length + 9)).toBe(120);
  });
});

describe("lowsCut", () => {
  it("cuts one track's lows at a time and swaps them around the midpoint", () => {
    expect(lowsCut(plan, 0)).toEqual({ out: -0, in: -24 });
    expect(lowsCut(plan, 0.5)).toEqual({ out: -12, in: -12 });
    expect(lowsCut(plan, 1)).toEqual({ out: -24, in: -0 });
  });

  it("finishes the swap within one eighth of the mix", () => {
    expect(swapProgress(plan, 0.5 - 0.0625)).toBe(0);
    expect(swapProgress(plan, 0.5 + 0.0625)).toBe(1);
  });
});

describe("outgoingBeats", () => {
  it("lists the outgoing grid up to the last beat of the blend", () => {
    const beats = outgoingBeats(plan, -1);
    expect(beats[0]).toEqual({ time: -2 * beat, beat: -2 });
    expect(beats.at(-1)!.time).toBeCloseTo(length, 9);
    expect(beats.at(-1)!.beat).toBe(12);
  });
});

describe("isDownbeat", () => {
  it("marks every fourth beat, before and after the mix start", () => {
    expect([-8, -5, -4, 0, 3, 12].map(isDownbeat)).toEqual([
      true,
      false,
      true,
      true,
      false,
      true,
    ]);
  });
});

describe("incomingBeats", () => {
  it("lands every incoming beat on an outgoing beat once locked", () => {
    const locked = incomingBeats(plan, 1, 0.21, length);
    const grid = outgoingBeats(plan, -plan.prerollS);
    expect(locked.map((b) => b.beat)).toEqual(grid.map((b) => b.beat));
    locked.forEach((b, i) => expect(b.time).toBeCloseTo(grid[i]!.time, 9));
  });

  it("drifts at its own tempo and offset before the lock", () => {
    const loose = incomingBeats(plan, 0, 0.21, length);
    expect(loose[1]!.time - loose[0]!.time).toBeCloseTo(0.5, 9);
    const nearest = Math.min(...loose.map((b) => Math.abs(b.time)));
    expect(nearest).toBeGreaterThan(0.02);
  });

  it("spaces the beats back out to the incoming tempo after the blend", () => {
    const beats = incomingBeats(plan, 1, 0.21, length + 8);
    const last = beats.at(-1)!.time - beats.at(-2)!.time;
    expect(last).toBeCloseTo(0.5, 2);
    expect(beats.every((b) => b.time >= -plan.prerollS)).toBe(true);
    expect(beats.at(-1)!.beat - beats.at(-2)!.beat).toBe(1);
  });
});

describe("storyAt", () => {
  const { start, end } = storyWindow(plan);

  it("walks the window from before the pre-roll to the end of the tempo restore", () => {
    expect(storyAt(plan, 0).time).toBeCloseTo(start, 9);
    expect(storyAt(plan, 1).time).toBeCloseTo(end, 9);
    expect(storyAt(plan, 0.24).time).toBeCloseTo(0, 9);
    expect(storyAt(plan, 0.76).time).toBeCloseTo(length, 9);
  });

  it("locks the phase during the pre-roll, before the blend starts", () => {
    expect(storyAt(plan, 0).lock).toBe(0);
    expect(storyAt(plan, 0.24).lock).toBe(1);
  });

  it("moves through lock, blend, bass swap and release", () => {
    expect([0.1, 0.3, 0.6, 0.9].map((p) => storyAt(plan, p).stage)).toEqual([
      0, 1, 2, 3,
    ]);
    expect(storyAt(plan, 0.5).progress).toBeCloseTo(0.5, 9);
  });
});

describe("pulse and waveLevels", () => {
  it("peaks on a beat and decays until the next one", () => {
    expect(pulse(-1, [0, 0.5])).toBe(0);
    expect(pulse(0, [0, 0.5])).toBe(1);
    expect(pulse(0.2, [0, 0.5])).toBeLessThan(pulse(0.05, [0, 0.5]));
  });

  it("is deterministic, bounded and louder on the beat", () => {
    const times = Array.from({ length: 100 }, (_, i) => i * 0.02);
    const a = waveLevels(times, [0, 1], 4);
    expect(a).toEqual(waveLevels(times, [0, 1], 4));
    a.forEach((value) => {
      expect(value).toBeGreaterThan(0);
      expect(value).toBeLessThanOrEqual(1);
    });
    expect(a[50]!).toBeGreaterThan(a[40]!);
  });
});
