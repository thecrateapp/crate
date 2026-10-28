import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useSnapshotStream } from "./use-snapshot-stream";

class MockEventSource {
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent<string>) => void) | null = null;
  onerror: (() => void) | null = null;
  close = vi.fn();

  constructor(public readonly url: string) {
    sources.push(this);
  }
}

const sources: MockEventSource[] = [];

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  sources.length = 0;
});

describe("useSnapshotStream", () => {
  it("delivers valid snapshots and reconnects after a disconnect", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("EventSource", MockEventSource);
    const onPayload = vi.fn();
    const { result, unmount } = renderHook(() =>
      useSnapshotStream<{ revision: number }>("/snapshot-stream", onPayload),
    );

    expect(result.current).toBe("connecting");
    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toBe("/snapshot-stream");

    act(() => {
      sources[0]?.onopen?.();
      sources[0]?.onmessage?.({ data: '{"revision":2}' } as MessageEvent<string>);
    });
    expect(result.current).toBe("live");
    expect(onPayload).toHaveBeenCalledWith({ revision: 2 });

    act(() => sources[0]?.onerror?.());
    expect(result.current).toBe("reconnecting");
    expect(sources[0]?.close).toHaveBeenCalledOnce();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(sources).toHaveLength(2);
    expect(result.current).toBe("reconnecting");

    unmount();
    expect(sources[1]?.close).toHaveBeenCalledOnce();
  });

  it("does not open a stream without a URL", () => {
    vi.stubGlobal("EventSource", MockEventSource);
    const { result } = renderHook(() =>
      useSnapshotStream<{ revision: number }>(null, () => undefined),
    );
    expect(result.current).toBe("idle");
    expect(sources).toHaveLength(0);
  });
});
