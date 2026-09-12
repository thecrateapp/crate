import { describe, expect, it, vi } from "vitest";

import {
  recoverNativeResumeAuthorizationWithRetry,
  shouldHandleNativeSideEffectEvent,
} from "@/contexts/use-native-playback-event-bridge";

describe("recoverNativeResumeAuthorizationWithRetry", () => {
  it("retries when the queue hasn't been rehydrated yet on a cold start", async () => {
    vi.useFakeTimers();
    const recoverNativeBuffering = vi
      .fn()
      .mockResolvedValueOnce(false) // queue not loaded yet, right after relaunch
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true); // queue rehydrated, recovery succeeds

    const promise = recoverNativeResumeAuthorizationWithRetry(
      recoverNativeBuffering,
      true,
    );
    await vi.runAllTimersAsync();
    const recovered = await promise;

    expect(recovered).toBe(true);
    expect(recoverNativeBuffering).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });

  it("gives up and reports failure once every retry is exhausted", async () => {
    vi.useFakeTimers();
    const recoverNativeBuffering = vi.fn().mockResolvedValue(false);

    const promise = recoverNativeResumeAuthorizationWithRetry(
      recoverNativeBuffering,
      true,
    );
    await vi.runAllTimersAsync();
    const recovered = await promise;

    expect(recovered).toBe(false);
    expect(recoverNativeBuffering).toHaveBeenCalledTimes(4);
    vi.useRealTimers();
  });

  it("passes the requested autoplay flag through to each recovery attempt", async () => {
    vi.useFakeTimers();
    const recoverNativeBuffering = vi.fn().mockResolvedValueOnce(true);

    const promise = recoverNativeResumeAuthorizationWithRetry(
      recoverNativeBuffering,
      false,
    );
    await vi.runAllTimersAsync();
    await promise;

    expect(recoverNativeBuffering).toHaveBeenCalledWith(
      expect.objectContaining({ autoplay: false }),
    );
    vi.useRealTimers();
  });
});

describe("shouldHandleNativeSideEffectEvent", () => {
  it("drops an obsolete queue-ending event before it can mutate playback", () => {
    const isNativeEventStale = vi.fn(() => true);

    expect(
      shouldHandleNativeSideEffectEvent(
        { nativeTimeMs: 100 },
        isNativeEventStale,
      ),
    ).toBe(false);
    expect(isNativeEventStale).toHaveBeenCalledWith(100);
  });

  it("accepts a current native side-effect event", () => {
    expect(
      shouldHandleNativeSideEffectEvent({ nativeTimeMs: 200 }, () => false),
    ).toBe(true);
  });
});
