import { describe, expect, it } from "vitest";
import { GOVERNOR } from "../../content/admin/viz";
import {
  evaluateGovernor,
  governorSnapshot,
  type Snapshot,
} from "./governor-math";

const calm: Snapshot = {
  loadRatio: 0.4,
  iowaitPercent: 3,
  swapUsedPercent: 2,
  swapUsedMb: 40,
  memoryAvailablePercent: 60,
  activeUsers: 2,
  activeStreams: 2,
};

describe("evaluateGovernor", () => {
  it("allows work when every reading is under its limit", () => {
    expect(evaluateGovernor(calm, GOVERNOR)).toEqual([]);
  });

  it("reports each breach in the same words as the resource governor", () => {
    expect(
      evaluateGovernor(
        {
          ...calm,
          loadRatio: 0.93,
          iowaitPercent: 31.24,
          activeUsers: 12,
          activeStreams: 11,
        },
        GOVERNOR,
      ),
    ).toEqual([
      "12 active listener(s)>10",
      "11 recent stream(s)>10",
      "load 0.93>0.85",
      "iowait 31.2%>25.0%",
    ]);
  });

  it("ignores listeners for listener-insensitive work", () => {
    expect(
      evaluateGovernor({ ...calm, activeUsers: 40 }, GOVERNOR, false),
    ).toEqual([]);
  });

  it("counts swap only when it signals real memory pressure", () => {
    const stale = { ...calm, swapUsedPercent: 80, swapUsedMb: 100 };
    expect(evaluateGovernor(stale, GOVERNOR)).toEqual([]);
    expect(
      evaluateGovernor({ ...stale, memoryAvailablePercent: 9 }, GOVERNOR),
    ).toEqual(["swap 80.0%>30.0%"]);
    expect(evaluateGovernor({ ...stale, swapUsedMb: 900 }, GOVERNOR)).toEqual([
      "swap 80.0%>30.0%",
    ]);
  });
});

describe("governorSnapshot", () => {
  it("starts calm, spikes past the load limit mid-cycle and settles again", () => {
    expect(evaluateGovernor(governorSnapshot(0), GOVERNOR)).toEqual([]);
    expect(governorSnapshot(0.5).loadRatio).toBeGreaterThan(GOVERNOR.loadRatio);
    expect(evaluateGovernor(governorSnapshot(0.95), GOVERNOR)).toEqual([]);
  });

  it("wraps around the cycle", () => {
    expect(governorSnapshot(1.25)).toEqual(governorSnapshot(0.25));
  });
});
