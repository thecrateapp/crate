import { describe, expect, it, vi } from "vitest";

import {
  createNativeResumeAuthorizationCoordinator,
  recoverNativeResumeAuthorizationWithRetry,
  shouldHandleNativeSideEffectEvent,
} from "@/contexts/use-native-playback-event-bridge";
import { cancelNativePlaybackRecoveryIntent } from "@/lib/native-playback-intent";

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

  it("stops retrying when an explicit transport action cancels recovery", async () => {
    vi.useFakeTimers();
    let resolveFirst!: (value: boolean) => void;
    const recoverNativeBuffering = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveFirst = resolve;
        }),
    );

    const promise = recoverNativeResumeAuthorizationWithRetry(
      recoverNativeBuffering,
      true,
    );
    await vi.waitFor(() =>
      expect(recoverNativeBuffering).toHaveBeenCalledTimes(1),
    );

    cancelNativePlaybackRecoveryIntent();
    resolveFirst(false);
    await vi.runAllTimersAsync();

    await expect(promise).resolves.toBe(false);
    expect(recoverNativeBuffering).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

describe("native resume authorization coordinator", () => {
  const resumeEvent = {
    revision: "queue-rev-1",
    index: 0,
    positionMs: 0,
    playWhenReady: true,
    nativeSequence: 1,
    nativeTimeMs: 100,
  };

  it("starts only one recovery for duplicate events from the same revision", async () => {
    let resolveRecovery!: (value: boolean) => void;
    const recoverNativeBuffering = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRecovery = resolve;
        }),
    );
    const coordinator = createNativeResumeAuthorizationCoordinator(
      recoverNativeBuffering,
    );

    const first = coordinator.start(resumeEvent);
    const duplicate = coordinator.start({
      ...resumeEvent,
      nativeSequence: 2,
    });

    expect(duplicate).toBeNull();
    expect(recoverNativeBuffering).toHaveBeenCalledTimes(1);

    resolveRecovery(true);
    await expect(first).resolves.toBe("recovered");
  });

  it("starts a new recovery when play intent changes for the same revision", async () => {
    const pending: Array<(value: boolean) => void> = [];
    const recoverNativeBuffering = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          pending.push(resolve);
        }),
    );
    const coordinator = createNativeResumeAuthorizationCoordinator(
      recoverNativeBuffering,
    );

    const first = coordinator.start(resumeEvent);
    const updated = coordinator.start({
      ...resumeEvent,
      nativeSequence: 2,
      index: 2,
      positionMs: 42_000,
      playWhenReady: false,
    });

    expect(updated).not.toBeNull();
    expect(recoverNativeBuffering).toHaveBeenLastCalledWith(
      expect.objectContaining({
        autoplay: false,
        index: 2,
        positionMs: 42_000,
      }),
    );

    pending.forEach((resolve) => resolve(true));
    await Promise.all([first, updated]);
  });

  it("starts a new recovery when the cursor changes for the same revision", async () => {
    const pending: Array<(value: boolean) => void> = [];
    const recoverNativeBuffering = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          pending.push(resolve);
        }),
    );
    const coordinator = createNativeResumeAuthorizationCoordinator(
      recoverNativeBuffering,
    );

    const first = coordinator.start(resumeEvent);
    const updated = coordinator.start({
      ...resumeEvent,
      nativeSequence: 2,
      index: 2,
      positionMs: 42_000,
    });

    expect(updated).not.toBeNull();
    expect(recoverNativeBuffering).toHaveBeenLastCalledWith(
      expect.objectContaining({
        autoplay: true,
        index: 2,
        positionMs: 42_000,
      }),
    );

    pending.forEach((resolve) => resolve(true));
    await Promise.all([first, updated]);
  });

  it("cancels retries and suppresses late failure after disposal", async () => {
    vi.useFakeTimers();
    let resolveRecovery!: (value: boolean) => void;
    const recoverNativeBuffering = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRecovery = resolve;
        }),
    );
    const coordinator = createNativeResumeAuthorizationCoordinator(
      recoverNativeBuffering,
    );

    const recovery = coordinator.start(resumeEvent);
    coordinator.dispose();
    resolveRecovery(false);
    await vi.runAllTimersAsync();

    await expect(recovery).resolves.toBe("cancelled");
    expect(recoverNativeBuffering).toHaveBeenCalledTimes(1);
    expect(coordinator.start(resumeEvent)).toBeNull();
    vi.useRealTimers();
  });
});

describe("shouldHandleNativeSideEffectEvent", () => {
  it("drops an obsolete queue-ending event before it can mutate playback", () => {
    const isNativeEventStale = vi.fn(() => true);

    expect(
      shouldHandleNativeSideEffectEvent(
        { nativeSequence: 1, nativeTimeMs: 100 },
        isNativeEventStale,
      ),
    ).toBe(false);
    expect(isNativeEventStale).toHaveBeenCalledWith({
      nativeSequence: 1,
      nativeTimeMs: 100,
    });
  });

  it("accepts a current native side-effect event", () => {
    expect(
      shouldHandleNativeSideEffectEvent(
        { nativeSequence: 2, nativeTimeMs: 200 },
        () => false,
      ),
    ).toBe(true);
  });
});
