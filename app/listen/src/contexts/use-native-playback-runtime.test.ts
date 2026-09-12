import { afterEach, describe, expect, it, vi } from "vitest";

import {
  isStaleNativeEvent,
  type NativeEventWatermark,
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
    const watermark: { current: NativeEventWatermark } = { current: null };

    expect(isStaleNativeEvent({ nativeTimeMs: 5_000 }, watermark)).toBe(false);
    expect(watermark.current).toEqual({ kind: "timestamp", value: 5_000 });

    // A drained/buffered event describing an earlier moment than what a
    // live event already advanced state to.
    expect(isStaleNativeEvent({ nativeTimeMs: 3_000 }, watermark)).toBe(true);
    expect(watermark.current).toEqual({ kind: "timestamp", value: 5_000 });

    expect(isStaleNativeEvent({ nativeTimeMs: 5_001 }, watermark)).toBe(false);
    expect(watermark.current).toEqual({ kind: "timestamp", value: 5_001 });
  });

  it("lets events with no timestamp through without moving the watermark", () => {
    const watermark = {
      current: { kind: "timestamp" as const, value: 5_000 },
    };

    expect(isStaleNativeEvent({}, watermark)).toBe(false);
    expect(watermark.current).toEqual({ kind: "timestamp", value: 5_000 });
  });

  it("orders same-millisecond events by their monotonic native sequence", () => {
    const watermark: { current: NativeEventWatermark } = { current: null };

    expect(
      isStaleNativeEvent(
        { nativeSequence: 41, nativeTimeMs: 5_000 },
        watermark,
      ),
    ).toBe(false);
    expect(
      isStaleNativeEvent(
        { nativeSequence: 42, nativeTimeMs: 5_000 },
        watermark,
      ),
    ).toBe(false);
    expect(watermark.current).toEqual({ kind: "sequence", value: 42 });
  });

  it("rejects a lower sequence even when its wall clock is newer", () => {
    const watermark: { current: NativeEventWatermark } = { current: null };

    expect(
      isStaleNativeEvent({ nativeSequence: 9, nativeTimeMs: 5_000 }, watermark),
    ).toBe(false);
    expect(
      isStaleNativeEvent({ nativeSequence: 8, nativeTimeMs: 6_000 }, watermark),
    ).toBe(true);
    expect(watermark.current).toEqual({ kind: "sequence", value: 9 });
  });
});
