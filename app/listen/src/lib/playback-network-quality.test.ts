import { describe, expect, it } from "vitest";

import {
  getEffectiveAutoPlaybackPolicy,
  getPlaybackNetworkHint,
  recordPlaybackStall,
  recordStablePlayback,
  resetPlaybackQualitySignals,
  type NetworkHint,
} from "./playback-network-quality";

const desktopDefault = "original" as const;

describe("getEffectiveAutoPlaybackPolicy", () => {
  it("uses data saver for explicitly constrained network hints", () => {
    expect(
      getEffectiveAutoPlaybackPolicy(
        { saveData: true },
        { consecutiveStalls: 0, stablePlaybackSeconds: 0 },
        desktopDefault,
      ),
    ).toBe("data_saver");
    expect(
      getEffectiveAutoPlaybackPolicy(
        { effectiveType: "2g" },
        { consecutiveStalls: 0, stablePlaybackSeconds: 0 },
        desktopDefault,
      ),
    ).toBe("data_saver");
  });

  it("uses balanced for a moderate connection and the platform default otherwise", () => {
    expect(
      getEffectiveAutoPlaybackPolicy(
        { effectiveType: "3g" },
        { consecutiveStalls: 0, stablePlaybackSeconds: 0 },
        desktopDefault,
      ),
    ).toBe("balanced");
    expect(
      getEffectiveAutoPlaybackPolicy(
        {},
        { consecutiveStalls: 0, stablePlaybackSeconds: 0 },
        desktopDefault,
      ),
    ).toBe("original");
  });

  it("downgrades after repeated stalls but never upgrades above the platform default", () => {
    expect(
      getEffectiveAutoPlaybackPolicy(
        {},
        { consecutiveStalls: 2, stablePlaybackSeconds: 0 },
        desktopDefault,
      ),
    ).toBe("balanced");
    expect(
      getEffectiveAutoPlaybackPolicy(
        { effectiveType: "3g" },
        { consecutiveStalls: 2, stablePlaybackSeconds: 0 },
        desktopDefault,
      ),
    ).toBe("data_saver");
  });
});

describe("getPlaybackNetworkHint", () => {
  it("maps the browser connection API to a serializable quality hint", () => {
    const connection = {
      saveData: false,
      effectiveType: "3g",
      downlink: 2.5,
      rtt: 380,
    };

    expect(getPlaybackNetworkHint(connection)).toEqual<NetworkHint>({
      saveData: false,
      effectiveType: "3g",
      downlinkMbps: 2.5,
      rttMs: 380,
    });
  });
});

describe("session playback signals", () => {
  it("downgrades after two recent stalls and recovers only after stable playback", () => {
    resetPlaybackQualitySignals();
    recordPlaybackStall(1_000);
    const degraded = recordPlaybackStall(2_000);
    expect(degraded.consecutiveStalls).toBe(2);

    const stable = recordStablePlayback(120);
    expect(stable.consecutiveStalls).toBe(0);
    expect(stable.stablePlaybackSeconds).toBe(120);
  });
});
