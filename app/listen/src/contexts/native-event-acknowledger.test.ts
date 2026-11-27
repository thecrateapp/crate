import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createNativeEventAcknowledger } from "./native-event-acknowledger";

describe("createNativeEventAcknowledger", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("acknowledges the highest observed sequence once the burst settles", () => {
    const acknowledge = vi.fn();
    const acknowledger = createNativeEventAcknowledger(acknowledge, 1000);

    acknowledger.observe({ nativeSequence: 4 });
    acknowledger.observe({ nativeSequence: 9 });
    acknowledger.observe({ nativeSequence: 7 });
    vi.advanceTimersByTime(999);
    expect(acknowledge).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(acknowledge).toHaveBeenCalledExactlyOnceWith(9);
  });

  it("flushes immediately and never re-acknowledges an older sequence", () => {
    const acknowledge = vi.fn();
    const acknowledger = createNativeEventAcknowledger(acknowledge, 1000);

    acknowledger.observe({ nativeSequence: 5 });
    acknowledger.flush();
    acknowledger.observe({ nativeSequence: 3 });
    acknowledger.flush();
    vi.advanceTimersByTime(5000);

    expect(acknowledge).toHaveBeenCalledExactlyOnceWith(5);
  });

  it("ignores events without a native sequence", () => {
    const acknowledge = vi.fn();
    const acknowledger = createNativeEventAcknowledger(acknowledge, 1000);

    acknowledger.observe({});
    acknowledger.observe({ nativeSequence: Number.NaN });
    acknowledger.flush();

    expect(acknowledge).not.toHaveBeenCalled();
  });

  it("flushes what it saw when disposed", () => {
    const acknowledge = vi.fn();
    const acknowledger = createNativeEventAcknowledger(acknowledge, 1000);

    acknowledger.observe({ nativeSequence: 2 });
    acknowledger.dispose();
    acknowledger.observe({ nativeSequence: 8 });
    vi.advanceTimersByTime(5000);

    expect(acknowledge).toHaveBeenCalledExactlyOnceWith(2);
  });
});
