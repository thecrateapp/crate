import { afterEach, describe, expect, it, vi } from "vitest";

import { waitForTask } from "./tasks";

class MockEventSource {
  static latest: MockEventSource | null = null;

  private readonly listeners = new Map<string, (event: MessageEvent) => void>();

  readonly close = vi.fn();
  onerror: (() => void) | null = null;

  constructor(readonly url: string) {
    MockEventSource.latest = this;
  }

  addEventListener(type: string, listener: EventListener) {
    this.listeners.set(type, listener as (event: MessageEvent) => void);
  }

  emit(type: string, payload: unknown) {
    this.listeners.get(type)?.({
      data: JSON.stringify(payload),
    } as MessageEvent);
  }
}

afterEach(() => {
  MockEventSource.latest = null;
  vi.unstubAllGlobals();
});

describe("waitForTask", () => {
  it("loads the committed result when task_done omits it", async () => {
    vi.stubGlobal("EventSource", MockEventSource);

    let fetchCalls = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        fetchCalls += 1;
        if (fetchCalls === 1) {
          return Response.json({ status: "running" });
        }
        return Response.json({
          id: "preview-task",
          status: "completed",
          result: { preview_url: "/preview.webp" },
        });
      }),
    );

    const completion = waitForTask("preview-task");
    await vi.waitFor(() => expect(MockEventSource.latest).not.toBeNull());

    MockEventSource.latest?.emit("task_done", { status: "completed" });

    await expect(completion).resolves.toEqual({
      status: "completed",
      result: { preview_url: "/preview.webp" },
      error: undefined,
    });
    expect(fetchCalls).toBe(2);
  });
});
