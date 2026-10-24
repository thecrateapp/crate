import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useNativePlaybackReconciliation } from "./use-native-playback-reconciliation";
import type { EngineMixState, EngineState } from "@/lib/playback-engine";

const native = vi.hoisted(() => ({ revision: "queue-a" }));
vi.mock("@/lib/android-native-engine", () => ({
  androidNativeEngine: {
    isCurrentQueueRevision: (revision: string) => revision === native.revision,
  },
}));
const mix: EngineMixState = {
  revision: "queue-a",
  executionId: 5,
  mode: "beatmatch",
  phase: "mixing",
  bassHandoff: true,
  outgoingTrackId: "a",
  incomingTrackId: "b",
  durationMs: 3000,
};
const snapshot: EngineState = {
  revision: "queue-a",
  nativeSequence: 10,
  playbackState: "playing",
  isPlaying: true,
  index: 0,
  positionMs: 5000,
  durationMs: 90000,
  queueSize: 2,
  crossfadeMs: 3000,
  eqEnabled: false,
};
function params() {
  return {
    clearNativeBufferingRecovery: vi.fn(),
    clearNativeBufferingWatchdog: vi.fn(),
    commitCurrentIndex: vi.fn(),
    commitCurrentTime: vi.fn(),
    commitDuration: vi.fn(),
    commitIsBuffering: vi.fn(),
    commitIsPlaying: vi.fn(),
    currentIndexRef: { current: 0 },
    currentTrackRef: { current: { id: "a", title: "A", artist: "Band" } },
    ensureTrackerSession: vi.fn(),
    playSourceRef: { current: null },
    queueRef: {
      current: [
        { id: "a", title: "A", artist: "Band" },
        { id: "b", title: "B", artist: "Band" },
      ],
    },
    recordProgress: vi.fn(),
    rememberActiveTrack: vi.fn(),
    repeatRef: { current: "off" as const },
    rotateTrackerSession: vi.fn(),
    scheduleNativeBufferingWatchdog: vi.fn(),
    setMixState: vi.fn(),
  };
}
describe("native actual mix state reconciliation", () => {
  beforeEach(() => {
    native.revision = "queue-a";
  });
  it("restores actual execution from a snapshot, including beatmatch at unchanged tempo", () => {
    const options = params();
    const { result } = renderHook(() =>
      useNativePlaybackReconciliation(options),
    );
    act(() => result.current.applyNativeState({ ...snapshot, mixState: mix }));
    expect(options.setMixState).toHaveBeenCalledWith(mix);
  });
  it("clears unknown state for an old plugin instead of deriving a technique from crossfadeMs", () => {
    const options = params();
    const { result } = renderHook(() =>
      useNativePlaybackReconciliation(options),
    );
    act(() => result.current.applyNativeState(snapshot));
    expect(options.setMixState).toHaveBeenCalledWith(null);
  });
  it("keeps explicit ordinary crossfade telemetry distinct from beatmatch", () => {
    const options = params();
    const { result } = renderHook(() =>
      useNativePlaybackReconciliation(options),
    );
    act(() =>
      result.current.applyNativeState({
        ...snapshot,
        mixState: { ...mix, mode: "crossfade", bassHandoff: false },
      }),
    );
    expect(options.setMixState).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "crossfade", bassHandoff: false }),
    );
  });
  it("does not let an older snapshot clear newer actual state", () => {
    const options = params();
    const { result } = renderHook(() =>
      useNativePlaybackReconciliation(options),
    );
    act(() =>
      result.current.applyNativeState({
        ...snapshot,
        nativeSequence: 11,
        mixState: mix,
      }),
    );
    options.setMixState.mockClear();
    act(() => result.current.applyNativeState(snapshot));
    expect(options.setMixState).not.toHaveBeenCalled();
  });
  it("orders live mix events and snapshots together, rejecting stale and wrong-revision clears", () => {
    const options = params();
    const { result } = renderHook(() =>
      useNativePlaybackReconciliation(options),
    );
    act(() =>
      result.current.applyNativeMixState({
        revision: "queue-a",
        nativeSequence: 11,
        mixState: mix,
      }),
    );
    options.setMixState.mockClear();
    act(() => result.current.applyNativeState(snapshot));
    act(() =>
      result.current.applyNativeMixState({
        revision: "old-queue",
        nativeSequence: 99,
        mixState: null,
      }),
    );
    expect(options.setMixState).not.toHaveBeenCalled();
    act(() =>
      result.current.applyNativeMixState({
        revision: "queue-a",
        nativeSequence: 12,
        mixState: null,
      }),
    );
    expect(options.setMixState).toHaveBeenCalledExactlyOnceWith(null);
  });
  it("rejects wrong-revision snapshots without poisoning the current event watermark", () => {
    const options = params();
    const { result } = renderHook(() =>
      useNativePlaybackReconciliation(options),
    );
    act(() =>
      result.current.applyNativeState({
        ...snapshot,
        revision: "old-queue",
        nativeSequence: 99,
        mixState: null,
      }),
    );
    expect(options.commitCurrentTime).not.toHaveBeenCalled();
    act(() =>
      result.current.applyNativeMixState({
        revision: "queue-a",
        nativeSequence: 12,
        mixState: mix,
      }),
    );
    expect(options.setMixState).toHaveBeenCalledExactlyOnceWith(mix);
  });
  it.each(["applyNativePosition", "applyNativeTrackChange"] as const)(
    "rejects old queue %s before it consumes the shared watermark",
    (method) => {
      const options = params();
      const { result } = renderHook(() =>
        useNativePlaybackReconciliation(options),
      );
      act(() =>
        result.current[method]({
          ...snapshot,
          revision: "old-queue",
          nativeSequence: 99,
        }),
      );
      expect(options.commitCurrentTime).not.toHaveBeenCalled();
      act(() =>
        result.current.applyNativeMixState({
          revision: "queue-a",
          nativeSequence: 12,
          mixState: mix,
        }),
      );
      expect(options.setMixState).toHaveBeenCalledExactlyOnceWith(mix);
    },
  );
  it.each([
    { ...mix, revision: "old-queue" },
    { ...mix, mode: "beatmatch", phase: "idle" },
    { ...mix, executionId: Number.NaN },
  ])("keeps invalid or mismatched execution unknown", (mixState) => {
    const options = params();
    const { result } = renderHook(() =>
      useNativePlaybackReconciliation(options),
    );
    act(() =>
      result.current.applyNativeState({
        ...snapshot,
        mixState: mixState as EngineMixState,
      }),
    );
    expect(options.setMixState).toHaveBeenCalledWith(null);
  });
});
