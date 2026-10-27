import { describe, expect, it } from "vitest";
import { APPROVE_AT, flowAt } from "./approval-math";

const WEIGHTS = [1, 1, 1, 2, 1, 1];
const GATE = 3;

describe("flowAt", () => {
  it("starts on the first step with nothing approved", () => {
    const frame = flowAt(0, WEIGHTS, GATE);
    expect(frame.index).toBe(0);
    expect(frame.states).toEqual([
      "active",
      "pending",
      "pending",
      "pending",
      "pending",
      "pending",
    ]);
    expect(frame.approved).toBe(false);
    expect(frame.fill).toBe(0);
  });

  it("gives the approval step its weight in scroll distance", () => {
    expect(flowAt(3 / 7, WEIGHTS, GATE).index).toBe(3);
    expect(flowAt(4.9 / 7, WEIGHTS, GATE).index).toBe(3);
    expect(flowAt(5 / 7, WEIGHTS, GATE).index).toBe(4);
  });

  it("waits for a person before the plan counts as approved", () => {
    const waiting = flowAt((3 + 2 * APPROVE_AT - 0.1) / 7, WEIGHTS, GATE);
    const approved = flowAt((3 + 2 * APPROVE_AT + 0.1) / 7, WEIGHTS, GATE);
    expect(waiting.index).toBe(GATE);
    expect(waiting.approved).toBe(false);
    expect(approved.index).toBe(GATE);
    expect(approved.approved).toBe(true);
  });

  it("never reaches apply without an approval", () => {
    for (let progress = 0; progress <= 1; progress += 0.01) {
      const frame = flowAt(progress, WEIGHTS, GATE);
      if (frame.index > GATE) expect(frame.approved).toBe(true);
    }
  });

  it("ends with every step done and the rail full", () => {
    const frame = flowAt(1, WEIGHTS, GATE);
    expect(frame.finished).toBe(true);
    expect(frame.states.every((state) => state === "done")).toBe(true);
    expect(frame.fill).toBe(1);
  });

  it("clamps progress outside 0..1", () => {
    expect(flowAt(-1, WEIGHTS, GATE).index).toBe(0);
    expect(flowAt(2, WEIGHTS, GATE).finished).toBe(true);
  });
});
