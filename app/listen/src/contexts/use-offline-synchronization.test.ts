import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/capacitor", () => ({
  onAppResume: vi.fn(() => () => {}),
}));

vi.mock("@/lib/offline", () => ({
  getOfflineTrackAssetKey: vi.fn(),
  getOfflineTrackManifestPaths: vi.fn(() => []),
  isOfflineBusy: vi.fn(() => false),
}));

import { EMPTY_OFFLINE_SNAPSHOT } from "@/lib/offline-model";
import { useOfflineSynchronization } from "@/contexts/use-offline-synchronization";

function setVisibility(state: "hidden" | "visible"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: state,
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

function renderSynchronization(abort: () => void) {
  const transferAbortRef = { current: { abort } as unknown as AbortController };
  renderHook(() =>
    useOfflineSynchronization({
      enqueue: (fn) => fn(),
      profileKey: "user-1",
      snapshot: EMPTY_OFFLINE_SNAPSHOT,
      snapshotRef: { current: EMPTY_OFFLINE_SNAPSHOT },
      supported: true,
      syncManifestIntoItem: vi.fn(),
      transferAbortRef,
    }),
  );
}

describe("useOfflineSynchronization background abort", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    setVisibility("visible");
  });

  it("does not abort an in-flight transfer for a quick glance at another app", () => {
    const abort = vi.fn();
    renderSynchronization(abort);

    setVisibility("hidden");
    vi.advanceTimersByTime(5_000);
    setVisibility("visible");
    vi.advanceTimersByTime(20_000);

    expect(abort).not.toHaveBeenCalled();
  });

  it("aborts an in-flight transfer once the app stays backgrounded", () => {
    const abort = vi.fn();
    renderSynchronization(abort);

    setVisibility("hidden");
    vi.advanceTimersByTime(10_000);

    expect(abort).toHaveBeenCalledTimes(1);
  });

  it("serializes an explicit sync through the shared operation queue", async () => {
    let enqueueCalls = 0;
    const enqueue = <T>(fn: () => Promise<T>): Promise<T> => {
      enqueueCalls += 1;
      return fn();
    };
    const { result } = renderHook(() =>
      useOfflineSynchronization({
        enqueue,
        profileKey: "user-1",
        snapshot: EMPTY_OFFLINE_SNAPSHOT,
        snapshotRef: { current: EMPTY_OFFLINE_SNAPSHOT },
        supported: true,
        syncManifestIntoItem: vi.fn(),
        transferAbortRef: { current: null },
      }),
    );

    await act(async () => result.current.syncAll());

    expect(enqueueCalls).toBe(1);
  });
});
