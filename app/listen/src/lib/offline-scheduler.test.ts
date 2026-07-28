import { describe, expect, it, vi } from "vitest";

import {
  createCoalescedOfflineWriter,
  runBoundedOfflineTasks,
  waitForOfflineTransferPermission,
} from "@/lib/offline-scheduler";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("offline scheduler", () => {
  it("runs at most two transfers at once", async () => {
    const gates = Array.from({ length: 4 }, () => deferred());
    let active = 0;
    let peak = 0;
    const work = runBoundedOfflineTasks(
      [0, 1, 2, 3],
      async (index) => {
        active += 1;
        peak = Math.max(peak, active);
        await gates[index]!.promise;
        active -= 1;
      },
      { concurrency: 2 },
    );

    await vi.waitFor(() => expect(active).toBe(2));
    expect(peak).toBe(2);
    gates[0]!.resolve();
    gates[1]!.resolve();
    await vi.waitFor(() => expect(active).toBe(2));
    gates[2]!.resolve();
    gates[3]!.resolve();
    await work;
    expect(peak).toBe(2);
  });

  it("stops scheduling new transfers after cancellation", async () => {
    const controller = new AbortController();
    const first = deferred();
    const started: number[] = [];
    const work = runBoundedOfflineTasks(
      [0, 1, 2],
      async (index) => {
        started.push(index);
        if (index === 0) await first.promise;
      },
      { concurrency: 1, signal: controller.signal },
    );

    await vi.waitFor(() => expect(started).toEqual([0]));
    controller.abort();
    first.resolve();
    await expect(work).resolves.toEqual({
      completed: 1,
      cancelled: true,
    });
    expect(started).toEqual([0]);
  });

  it("coalesces progress writes and flushes the latest value", () => {
    vi.useFakeTimers();
    const writes: string[] = [];
    const writer = createCoalescedOfflineWriter<string>(
      (value) => writes.push(value),
      100,
    );

    writer.schedule("one");
    writer.schedule("two");
    writer.schedule("three");
    expect(writes).toEqual([]);

    vi.advanceTimersByTime(100);
    expect(writes).toEqual(["three"]);

    writer.schedule("four");
    writer.flush();
    expect(writes).toEqual(["three", "four"]);
    writer.dispose();
    vi.useRealTimers();
  });

  it("waits for the app to return to the foreground", async () => {
    const originalVisibility = document.visibilityState;
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    const permission = waitForOfflineTransferPermission();
    let resolved = false;
    void permission.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "visible",
    });
    document.dispatchEvent(new Event("visibilitychange"));
    await permission;
    expect(resolved).toBe(true);
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: originalVisibility,
    });
  });
});
