import { describe, expect, it } from "vitest";
import fixture from "../../../data/blog-smart-mix-fixture.json";
import { restTime } from "./phase-clock";
import {
  candidateStarts,
  clashSpans,
  crossfadeGains,
  formatSeconds,
  fullLevelSpan,
  MIX_MS,
  PHASE_PLANS,
  phraseAt,
  sceneGeometry,
  SMART_MIX_STATES,
  SMART_MIX_TRACKS,
  smartMixData,
  smartMixFrame,
  smartMixReadout,
  toMixX,
  toSourceX,
  VIEW,
  type PlanId,
  type SmartMixState,
} from "./smart-mix";

const data = smartMixData(fixture);
const choices = [...fixture.choices, fixture.fallback];
const choice = (id: PlanId) => choices.find((entry) => entry.id === id)!;
const pinned = (state: SmartMixState, phase: number) =>
  smartMixFrame(data, state, restTime(SMART_MIX_TRACKS[state], phase));
const end = (state: SmartMixState) =>
  smartMixFrame(data, state, SMART_MIX_TRACKS[state].period - 0.001);

describe("smart mix figure model", () => {
  it("has one phase start, one pin and one plan per phase of copy", () => {
    for (const state of SMART_MIX_STATES) {
      const track = SMART_MIX_TRACKS[state.id];
      expect(track.starts).toHaveLength(state.phases.length);
      expect(track.pins).toHaveLength(state.phases.length);
      expect(PHASE_PLANS[state.id]).toHaveLength(state.phases.length);
      track.pins!.forEach((pin, i) => {
        expect(pin).toBeGreaterThanOrEqual(track.starts[i]!);
        expect(pin).toBeLessThan(track.starts[i + 1] ?? track.period);
      });
    }
  });

  it("keeps v2's dj-blend at or above half gain on both decks for the middle 63 %", () => {
    const [from, to] = fullLevelSpan("dj-blend");
    expect(from).toBeCloseTo(0.1839, 3);
    expect(to).toBeCloseTo(0.8161, 3);
    const mid = crossfadeGains(0.5, "dj-blend");
    expect(mid.a).toBeCloseTo(Math.SQRT1_2, 6);
    expect(mid.b).toBeCloseTo(Math.SQRT1_2, 6);
    expect(crossfadeGains(1, "dj-blend")).toEqual({ a: 0, b: 1 });
  });

  it("reproduces the evaluator's vocal clash for every exported plan", () => {
    for (const entry of choices) {
      const spans = clashSpans(fixture, entry.id as PlanId);
      const expected = entry.metrics.vocalClashMs;
      if (expected === null) {
        expect(spans).toBeNull();
        continue;
      }
      const total = spans!.reduce((sum, [from, to]) => sum + to - from, 0);
      expect(Math.abs(total - expected)).toBeLessThanOrEqual(10);
      expect(data.plans[entry.id as PlanId].clashMs).toBe(expected);
    }
  });

  it("matches the exported phrase alignment and music left out at rest", () => {
    for (const entry of choices) {
      const plan = data.plans[entry.id as PlanId];
      const aligned = plan.aligned.filter(Boolean).length;
      expect(aligned).toBe(entry.metrics.phraseAlignment.aligned);
      expect(plan.basis).toBe(entry.metrics.phraseAlignment.basis);
      const frame = smartMixFrame(data, "v3", 9.99);
      Object.assign(frame, { plan, window: plan, aligned: plan.aligned });
      const readout = smartMixReadout(data, frame);
      expect(readout.aUnplayed.value).toBe(
        formatSeconds(entry.metrics.musicLeftOut.outgoingUnplayedMs),
      );
      expect(readout.bSkipped.value).toBe(
        formatSeconds(entry.metrics.musicLeftOut.incomingSkippedMs),
      );
      expect(readout.aligned.value).toBe(`${aligned} / 4`);
      expect(readout.aligned.unit).toBe(entry.metrics.phraseAlignment.basis);
    }
    expect(data.plans.alternative.aligned).toEqual([true, false, true, true]);
  });

  it("starts candidates on A's last four phrases and B's first three", () => {
    expect(candidateStarts(fixture)).toEqual({
      outgoing: [46560, 108000, 138720, 200160],
      incoming: [480, 31200, 46560],
    });
  });

  it("states the article's plans: outro into intro, break into intro, outro into build", () => {
    const kind = (role: "outgoing" | "incoming", ms: number) =>
      phraseAt(fixture.tracks[role], ms)?.kind;
    expect(kind("outgoing", data.plans.v2.aStart)).toBe("outro");
    expect(kind("incoming", data.plans.v2.bStart)).toBe("intro");
    expect(kind("outgoing", data.plans.v3.aStart)).toBe("break");
    expect(kind("incoming", data.plans.v3.bStart)).toBe("intro");
    expect(kind("outgoing", data.plans.alternative.aStart)).toBe("outro");
    expect(kind("incoming", data.plans.alternative.bStart)).toBe("build");
  });

  it("falls back to exactly v2's plan without structure, with voice unknown", () => {
    const fallback = data.plans["missing-structure"];
    const v2 = data.plans.v2;
    for (const key of ["aStart", "aEnd", "bStart", "bEnd", "durationMs"] as const)
      expect(fallback[key]).toBe(v2[key]);
    expect(fallback.voice).toBeNull();
    expect(fallback.clash).toBeNull();
    const frame = pinned("no-structure", 2);
    expect(frame.structure).toBe(false);
    expect(frame.voiceKnown).toBe(false);
    expect(smartMixReadout(data, frame).clash).toEqual({
      value: "Unknown",
      unit: "",
      tone: undefined,
    });
    expect(smartMixReadout(data, frame).aligned).toEqual({
      value: "4 / 4",
      unit: "grid",
      tone: undefined,
    });
  });

  it("quotes the fixture's numbers in the phase copy", () => {
    const copy = (id: SmartMixState) =>
      SMART_MIX_STATES.find((state) => state.id === id)!
        .phases.map((phase) => phase.body)
        .join(" ");
    const seconds = (ms: number) => (ms / 1000).toFixed(2);
    expect(copy("v2")).toContain(seconds(choice("v2").metrics.vocalClashMs!));
    expect(copy("v3")).toContain(seconds(choice("v2").metrics.vocalClashMs!));
    expect(copy("v3")).toContain(
      seconds(choice("v3").metrics.musicLeftOut.outgoingUnplayedMs),
    );
    expect(copy("v3")).toContain(
      seconds(choice("alternative").metrics.musicLeftOut.outgoingUnplayedMs),
    );
    expect(copy("v3")).toContain("`smart-mix-v3`");
    expect(SMART_MIX_STATES[0].label).toContain("default");
  });

  it("grows v2's window bar by bar from the outro cue to sixteen bars", () => {
    const track = SMART_MIX_TRACKS.v2;
    const early = smartMixFrame(data, "v2", 1.2);
    expect(early.window.aStart).toBe(data.plans.v2.aStart);
    expect(early.window.durationMs % data.barMs).toBe(0);
    expect(early.window.durationMs).toBeLessThan(data.plans.v2.durationMs);
    expect(smartMixReadout(data, early).aligned).toEqual({
      value: "2 / 4",
      unit: "phrases",
      tone: undefined,
    });
    const grown = smartMixFrame(data, "v2", restTime(track, 0));
    expect(grown.window.durationMs).toBe(16 * data.barMs);
    expect(sceneGeometry(data, grown).mix).toEqual({
      name: "v2 plan",
      detail: "16 bars · 30.72 s",
    });
    expect(smartMixReadout(data, grown).aligned.value).toBe("4 / 4");
    expect(smartMixReadout(data, grown).clash.value).toBe("—");
  });

  it("counts v2's clash only while the playhead crosses voice on both decks", () => {
    const track = SMART_MIX_TRACKS.v2;
    let last = 0;
    for (let t = track.starts[1]!; t < track.starts[2]!; t += 0.05) {
      const frame = smartMixFrame(data, "v2", t);
      const counted = smartMixReadout(data, frame).clash;
      const value = counted.value === "—" ? 0 : Number(counted.value);
      expect(value).toBeGreaterThanOrEqual(last);
      last = value;
    }
    const done = smartMixReadout(data, pinned("v2", 1)).clash;
    expect(done).toEqual({ value: "19.42", unit: "s", tone: "warn" });
  });

  it("moves v3 from v2's plan to the runner-up and the first choice", () => {
    expect(pinned("v3", 0).plan.id).toBe("v2");
    expect(pinned("v3", 0).candidates).toBe(true);
    expect(smartMixReadout(data, pinned("v3", 1)).clash.tone).toBe("warn");
    const runnerUp = pinned("v3", 2);
    expect(runnerUp.window.bStart).toBe(data.plans.alternative.bStart);
    expect(smartMixReadout(data, runnerUp).aligned).toEqual({
      value: "3 / 4",
      unit: "phrases",
      tone: "warn",
    });
    expect(smartMixReadout(data, runnerUp).bSkipped).toEqual({
      value: "30.72",
      unit: "s",
      tone: "warn",
    });
    expect(smartMixReadout(data, pinned("v2", 2)).aUnplayed).toEqual({
      value: "0.00",
      unit: "s",
      tone: "ok",
    });
    const first = smartMixReadout(data, pinned("v3", 3));
    expect(first.clash).toEqual({ value: "0.00", unit: "s", tone: "ok" });
    expect(first.aUnplayed).toEqual({ value: "92.16", unit: "s", tone: "warn" });
  });

  it("slides the window between plans instead of jumping", () => {
    const track = SMART_MIX_TRACKS.v3;
    const mid = smartMixFrame(data, "v3", track.starts[3]! + 0.4);
    expect(mid.window.aStart).toBeLessThan(data.plans.alternative.aStart);
    expect(mid.window.aStart).toBeGreaterThan(data.plans.v3.aStart);
  });

  it("shows v3's first choice at the end of its track", () => {
    const frame = end("v3");
    expect(frame.plan.id).toBe("v3");
    expect(frame.window.aStart).toBe(data.plans.v3.aStart);
    expect(frame.reveal).toBe(1);
  });

  it("hides phrase structure in v2 and marks the cues instead", () => {
    const frame = pinned("v2", 0);
    expect(frame.structure).toBe(false);
    expect(frame.cues).toBe(true);
    expect(frame.ghost).toBe(false);
    expect(pinned("v3", 3).ghost).toBe(true);
    expect(pinned("no-structure", 1).grid).toBe(true);
  });

  it("places windows, hatches, lenses and playheads from the frame", () => {
    const span = fixture.tracks.outgoing.durationMs;
    const first = sceneGeometry(data, end("v3"));
    expect(first.aWin.x).toBeCloseTo(toSourceX(108000, span), 6);
    expect(first.aOmit.width).toBeCloseTo(toSourceX(92160, span), 6);
    expect(first.bOmit.width).toBeCloseTo(0, 6);
    expect(first.lit).toBeCloseTo(toMixX(30720), 6);
    expect(first.heads).toBeNull();
    expect(first.edges.every((edge) => edge.aligned)).toBe(true);
    expect(first.ranges.a.text).toBe("108.00–138.72 s");
    expect(first.ranges.b.text).toBe("0.48–31.20 s");
    expect(first.mix).toEqual({ name: "first choice", detail: "16 bars · 30.72 s" });
    expect(first.clash).toBe(false);

    const runnerUp = sceneGeometry(data, pinned("v3", 2));
    expect(runnerUp.edges.map((edge) => edge.aligned)).toEqual([
      true,
      false,
      true,
      true,
    ]);
    expect(runnerUp.bOmit.width).toBeCloseTo(toSourceX(30720, span), 6);

    const sweeping = sceneGeometry(
      data,
      smartMixFrame(data, "v2", (3.6 + 6.8) / 2),
    );
    expect(sweeping.heads!.mix).toBeCloseTo(toMixX(15360), 6);
    expect(sweeping.heads!.a).toBeCloseTo(toSourceX(200160 + 15360, span), 6);
    expect(sweeping.clash).toBe(true);
    expect(toMixX(MIX_MS)).toBe(VIEW.width);
  });
});
