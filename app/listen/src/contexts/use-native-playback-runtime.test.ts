import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isStaleNativeEvent,
  nativeTransitionFlushReason,
  projectedNativePositionSeconds,
} from "./use-native-playback-runtime";

describe("native playback runtime helpers", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("classifies sequential native transitions as completed", () => {
    expect(nativeTransitionFlushReason(undefined, 1, 2, 4, "off")).toBe(
      "completed",
    );
    expect(nativeTransitionFlushReason(undefined, 3, 0, 4, "all")).toBe(
      "completed",
    );
  });

  it("keeps explicit playlist transitions from flushing a play event", () => {
    expect(nativeTransitionFlushReason("playlist", 0, 3, 4, "off")).toBe(null);
    expect(nativeTransitionFlushReason("user", 0, 3, 4, "off")).toBe("skipped");
  });

  it("projects a playing native position without exceeding duration", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);

    expect(projectedNativePositionSeconds(4_000, 9_000, true, 5_000)).toBe(5);
  });

  it("does not project elapsed time while paused", () => {
    vi.spyOn(Date, "now").mockReturnValue(10_000);

    expect(projectedNativePositionSeconds(4_000, 1_000, false, 20_000)).toBe(4);
  });

  it("drops a buffered event older than the freshest one already applied", () => {
    const watermark = { current: 0 };

    expect(isStaleNativeEvent(5_000, watermark)).toBe(false);
    expect(watermark.current).toBe(5_000);

    // A drained/buffered event describing an earlier moment than what a
    // live event already advanced state to.
    expect(isStaleNativeEvent(3_000, watermark)).toBe(true);
    expect(watermark.current).toBe(5_000);

    expect(isStaleNativeEvent(5_001, watermark)).toBe(false);
    expect(watermark.current).toBe(5_001);
  });

  it("lets events with no timestamp through without moving the watermark", () => {
    const watermark = { current: 5_000 };

    expect(isStaleNativeEvent(undefined, watermark)).toBe(false);
    expect(watermark.current).toBe(5_000);
  });
});
