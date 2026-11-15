import { act, renderHook } from "@testing-library/react";
import { expect, it, vi } from "vitest";

vi.mock("@/lib/gapless-player", () => ({ initPlayer: () => ({}) }));
vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => false,
}));
vi.mock("@/lib/cast-sender", () => ({ isCastSessionActive: () => false }));

import { usePlayerRuntimeState } from "./use-player-runtime-state";

it("publishes the selected source synchronously before a rendering update", () => {
  const { result } = renderHook(() => usePlayerRuntimeState());
  act(() => {
    result.current.setPlaySource({ type: "album", name: "B" });
    expect(result.current.playSourceRef.current?.name).toBe("B");
    result.current.setPlaySource((previous) => ({ ...previous!, name: "C" }));
    expect(result.current.playSourceRef.current?.name).toBe("C");
  });
  expect(result.current.playSource?.name).toBe("C");
  expect(result.current.queueReadinessRef.current.ready).toBe(true);
});

it("keeps the exact tick time in the ref but commits progress state sparsely", () => {
  vi.useFakeTimers();
  try {
    const renders = vi.fn();
    const { result } = renderHook(() => {
      renders();
      return usePlayerRuntimeState();
    });
    act(() => result.current.commitPlaybackTick(12.1));
    expect(result.current.currentTime).toBe(12.1);
    const rendersAfterFirstTick = renders.mock.calls.length;

    act(() => {
      result.current.commitPlaybackTick(12.127);
      result.current.commitPlaybackTick(12.154);
    });
    expect(result.current.currentTimeRef.current).toBe(12.154);
    expect(result.current.currentTime).toBe(12.1);
    expect(renders.mock.calls.length).toBe(rendersAfterFirstTick);

    act(() => vi.advanceTimersByTime(250));
    expect(result.current.currentTime).toBe(12.154);

    act(() => result.current.commitPlaybackTick(13.001));
    expect(result.current.currentTime).toBe(13.001);
  } finally {
    vi.useRealTimers();
  }
});

it("commits seeks and resets immediately", () => {
  const { result } = renderHook(() => usePlayerRuntimeState());
  act(() => result.current.commitPlaybackTick(40.2));
  act(() => result.current.commitPlaybackTick(40.25));
  act(() => result.current.commitCurrentTime(40.9));

  expect(result.current.currentTime).toBe(40.9);
  expect(result.current.currentTimeRef.current).toBe(40.9);
});
