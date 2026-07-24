import { describe, expect, it } from "vitest";

import {
  canApplyNextTrackResolution,
  getNextTrackIndex,
} from "@/contexts/player-next-track-resolution";

describe("next-track playback resolution", () => {
  it("selects only the sequential next item, wrapping solely for repeat-all", () => {
    expect(getNextTrackIndex(3, 0, "off")).toBe(1);
    expect(getNextTrackIndex(3, 2, "off")).toBeNull();
    expect(getNextTrackIndex(3, 2, "all")).toBe(0);
    expect(getNextTrackIndex(3, 1, "one")).toBeNull();
  });

  it("rejects a resolved lookahead when queue or engine state moved on", () => {
    const queue = [{ id: "current" }, { id: "next" }];
    const snapshot = {
      queue,
      currentIndex: 0,
      nextIndex: 1,
      expectedUrl: "/api/catalog/tracks/next/stream",
    };

    expect(
      canApplyNextTrackResolution(snapshot, {
        queue,
        currentIndex: 0,
        engineIndex: 0,
        engineUrl: "/api/catalog/tracks/next/stream",
      }),
    ).toBe(true);
    expect(
      canApplyNextTrackResolution(snapshot, {
        queue: [...queue],
        currentIndex: 0,
        engineIndex: 0,
        engineUrl: "/api/catalog/tracks/next/stream",
      }),
    ).toBe(false);
    expect(
      canApplyNextTrackResolution(snapshot, {
        queue,
        currentIndex: 1,
        engineIndex: 1,
        engineUrl: "/api/catalog/tracks/next/stream",
      }),
    ).toBe(false);
    expect(
      canApplyNextTrackResolution(snapshot, {
        queue,
        currentIndex: 0,
        engineIndex: 0,
        engineUrl: "/api/catalog/tracks/other/stream",
      }),
    ).toBe(false);
  });
});
