import { describe, expect, it } from "vitest";
import fixture from "../../../data/blog-radio-fixture.json";
import {
  buildRadioScript,
  QUALITY_BAND,
  RADIO_COMMIT,
  RADIO_STATES,
  RADIO_TRACKS,
  radioFrame,
  radioReadout,
  SIGNIFICANT_SECONDS,
  type RadioFrame,
} from "./radio";

const script = buildRadioScript(fixture);
const track = RADIO_TRACKS.selector;
const pin = (phase: number) => track.pins![phase]!;
const at = (phase: number, local: number) => track.starts[phase]! + local;

const row = (frame: RadioFrame, title: string) => {
  const found = frame.rows.find((item) => item.title === title && item.visible);
  if (!found) throw new Error(`${title} is not visible`);
  return found;
};
const lane = (frame: RadioFrame, name: "buffer" | "delivered" | "heard") =>
  frame.lanes[name]
    .filter((chip) => chip.on)
    .sort((a, b) => a.order - b.order);

describe("radio rotation model", () => {
  it("has one phase start and one pin per phase of copy, inside each phase", () => {
    const [state] = RADIO_STATES;
    expect(RADIO_STATES).toHaveLength(1);
    expect(track.starts).toHaveLength(state.phases.length);
    expect(track.pins).toHaveLength(state.phases.length);
    expect(track.period).toBeGreaterThanOrEqual(8);
    expect(track.period).toBeLessThanOrEqual(10);
    track.pins!.forEach((value, i) => {
      expect(value).toBeGreaterThan(track.starts[i]!);
      expect(value).toBeLessThan(track.starts[i + 1] ?? track.period);
    });
  });

  it("replays the pinned Python export and keeps its constants", () => {
    expect(script.commit).toBe(RADIO_COMMIT);
    expect(fixture.source.commit).toBe(RADIO_COMMIT);
    expect(QUALITY_BAND).toBe(0.05);
    expect(SIGNIFICANT_SECONDS).toBe(30);
    const listen = script.phases[1]!;
    expect(listen.limit).toBeCloseTo(0.1 + QUALITY_BAND, 6);
    // The client gets a compact script, not the 40 KB fixture.
    expect(JSON.stringify(script).length).toBeLessThan(8000);
  });

  it("a buffered song and its live version are excluded before ranking", () => {
    const opening = radioFrame(script, at(1, 0.02));
    expect(opening.caseLabel).toMatch(/30 s/);
    const song = row(opening, "Song");
    const live = row(opening, "Song (Live)");
    expect(song).toMatchObject({ score: null, status: "buffer", verdict: true });
    expect(live).toMatchObject({ score: null, status: "family", verdict: true });
    expect(live.key).toBe(song.key);
    expect(lane(opening, "buffer").map((chip) => chip.label)).toEqual(["Song"]);
    expect(lane(opening, "buffer")[0]!.tone).toBe("hit");
  });

  it("a five-second skip is remembered by delivery, not by listening history", () => {
    for (const phase of [0, 3])
      for (let local = 0; local < 2.5; local += 0.05)
        expect(lane(radioFrame(script, at(phase, local)), "heard")).toEqual([]);

    const frame = radioFrame(script, pin(0));
    expect(frame.play).toMatchObject({ seconds: 5, threshold: 30, counted: false });
    expect(lane(frame, "delivered").map((chip) => chip.label)).toEqual([
      "a · delivered x",
      "b · fresh",
    ]);
    expect(lane(frame, "delivered")[0]!.tone).toBe("hit");
    expect(lane(frame, "delivered")[1]!.tone).toBe("new");
  });

  it("the delivery check passes over the best score without a quality band", () => {
    const frame = radioFrame(script, pin(0));
    expect(row(frame, "Delivered X")).toMatchObject({
      score: 0.1,
      status: "delivered",
      best: true,
      pick: null,
    });
    const fresh = row(frame, "Fresh");
    expect(fresh).toMatchObject({ score: 0.4, pick: "queued", pickTone: "ok" });
    expect(fresh.score!).toBeGreaterThan(0.1 + QUALITY_BAND);
    expect(frame.band).toMatchObject({ applied: false, from: 0.1 });
    expect(lane(frame, "buffer")).toEqual([
      expect.objectContaining({ label: "Fresh", tone: "new" }),
    ]);
    const readout = radioReadout(frame);
    expect(readout.best).toMatchObject({ text: "Delivered X", note: "0.10", tone: "warn" });
    expect(readout.band).toMatchObject({ text: "Not used", note: "ledger" });
    expect(readout.play).toMatchObject({ text: "5 s", note: "under 30 s" });
    expect(readout.queued).toMatchObject({ text: "Fresh", note: "0.40", tone: "ok" });
  });

  it("a significant listen rotates to a comparable unheard song within 0.05", () => {
    const frame = radioFrame(script, pin(1));
    expect(frame.play).toMatchObject({ seconds: 30, counted: true });
    expect(lane(frame, "heard")).toEqual([
      expect.objectContaining({ label: "a · song", tone: "hit" }),
    ]);
    expect(row(frame, "Song")).toMatchObject({ score: 0.1, status: "heard", best: true });
    expect(row(frame, "Song (Live)")).toMatchObject({ status: "heard", key: "a · song" });
    expect(row(frame, "Far").status).toBe("outside");
    const fresh = row(frame, "Fresh");
    expect(fresh).toMatchObject({ score: 0.14, status: "fresh", pick: "queued" });
    expect(frame.band).toMatchObject({ applied: true, from: 0.1, to: 0.15 });
    expect(fresh.score!).toBeLessThanOrEqual(frame.band!.to!);
    // A new session: the ledger holds only what this refill delivered.
    expect(lane(frame, "delivered").map((chip) => chip.label)).toEqual(["b · fresh"]);
    const readout = radioReadout(frame);
    expect(readout.band).toMatchObject({ text: "≤ 0.15", note: "0.10 + 0.05" });
    expect(readout.queued).toMatchObject({ text: "Fresh", tone: "ok" });
  });

  it("keeps the recent song when no unheard candidate fits the band", () => {
    const frame = radioFrame(script, pin(2));
    expect(frame.play).toBeNull();
    const recent = row(frame, "Delivered X");
    expect(recent).toMatchObject({ status: "heard", pick: "kept", pickTone: "warn" });
    for (const title of ["Fresh", "Far"])
      expect(row(frame, title).score!).toBeGreaterThan(frame.band!.to!);
    expect(radioReadout(frame).queued).toMatchObject({ text: "Delivered X", tone: "warn" });
    expect(radioReadout(frame).play.text).toBe("Earlier");
  });

  it("lets a delivered song return when the pool has nothing else", () => {
    const frame = radioFrame(script, pin(3));
    expect(frame.rows.filter((item) => item.visible)).toHaveLength(1);
    expect(frame.pool).toEqual({ ranked: 1, excluded: 0 });
    // Before the refill the same pool held three rows, one of them buffered.
    expect(radioFrame(script, at(3, 0.02)).pool).toEqual({ ranked: 2, excluded: 1 });
    expect(row(frame, "Delivered X")).toMatchObject({
      score: 1,
      status: "delivered",
      pick: "returns",
    });
    expect(lane(frame, "heard")).toEqual([]);
    // Reduced motion shows the end of the track: the same settled fallback.
    const end = radioFrame(script, track.period - 0.001);
    expect(radioReadout(end).queued.text).toBe("Delivered X");
  });

  it("reveals each verdict as the scan reaches its rank, then picks", () => {
    const early = radioFrame(script, at(1, 0.6));
    expect(early.scan).toBeNull();
    expect(early.band).toBeNull();
    expect(early.rows.filter((item) => item.visible && item.verdict)).toEqual([]);

    const first = radioFrame(script, at(1, 0.72));
    expect(first.scan).toBe(0);
    expect(row(first, "Song").verdict).toBe(true);
    expect(row(first, "Fresh").verdict).toBe(false);
    expect(first.band?.applied).toBe(true);
    expect(row(first, "Fresh").pick).toBeNull();

    const slots = radioFrame(script, pin(1)).rows
      .filter((item) => item.visible)
      .sort((a, b) => a.slot - b.slot)
      .map((item) => item.title);
    expect(slots).toEqual(["Song", "Fresh", "Song (Live)", "Far"]);
  });
});
