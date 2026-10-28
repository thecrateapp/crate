import { act, renderHook } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import type { PlaySource, Track } from "./player-types";
vi.mock("@/lib/radio", () => ({ fetchInfiniteContinuation: vi.fn() }));
vi.mock("@/lib/radio-continuation", () => ({
  fetchContinuationBatch: vi.fn(),
  acknowledgeContinuationBatch: vi.fn(),
}));
vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => false,
}));
import { fetchContinuationBatch } from "@/lib/radio-continuation";
import { usePlaybackIntelligence } from "./use-playback-intelligence";
const track: Track = { id: "a", title: "A", artist: "X" };
const next: Track = { id: "b", title: "B", artist: "Y" };
function options() {
  return {
    repeat: "off" as const,
    queue: [track],
    currentIndex: 0,
    isPlaying: true,
    playSource: {
      type: "album",
      name: "Album",
      radio: { seedType: "album", seedId: 42 },
    } as PlaySource,
    shuffle: false,
    infinitePlaybackEnabled: true,
    smartPlaylistSuggestionsEnabled: false,
    smartPlaylistSuggestionsCadence: 3,
    recentlyPlayed: [],
    actions: {
      appendTracks: vi.fn().mockResolvedValue(1),
      appendAndAdvance: vi.fn().mockResolvedValue(1),
      setBuffering: vi.fn(),
      insertSuggestionAfterCurrent: vi.fn(),
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(fetchContinuationBatch).mockResolvedValue({
    tracks: [next],
    status: "ok",
    batchIndex: 0,
    revision: 1,
  });
});
it("composes a single shared refill owner for an Infinite album", async () => {
  const opts = options();
  renderHook(() => usePlaybackIntelligence(opts));
  await act(async () => {});
  expect(fetchContinuationBatch).toHaveBeenCalledOnce();
  expect(opts.actions.appendTracks).toHaveBeenCalledOnce();
});
it("also continues shaped radios at EOF", async () => {
  const opts = options();
  opts.playSource = {
    type: "radio",
    name: "Radio",
    radio: { seedType: "discovery", shapedSessionId: "s" },
  };
  const { result } = renderHook(() => usePlaybackIntelligence(opts));
  act(() => {
    expect(result.current.continueInfinitePlayback()).toBe(true);
  });
  await act(async () => {});
  expect(opts.actions.appendAndAdvance).toHaveBeenCalledOnce();
});
it("exposes cancellation to Pause, Stop and source replacement", async () => {
  vi.mocked(fetchContinuationBatch).mockImplementation(
    () => new Promise(() => {}),
  );
  const opts = options();
  const { result } = renderHook(() => usePlaybackIntelligence(opts));
  await act(async () => {});
  act(() => result.current.resetPlaybackIntelligence());
  expect(vi.mocked(fetchContinuationBatch).mock.calls[0]?.[2].aborted).toBe(
    true,
  );
  expect(result.current.recoverAtEnd()).toBe(false);
});

it("uses committed state refs even before the next React render catches up", async () => {
  const opts = options();
  const replacement = {
    ...opts.playSource,
    name: "Replacement",
    radio: { seedType: "album" as const, seedId: 55 },
  };
  const replacementTrack = { ...track, id: "replacement" };
  const stateRefs = {
    queueRef: { current: [replacementTrack] },
    currentIndexRef: { current: 0 },
    playSourceRef: { current: replacement },
  };
  renderHook(() => usePlaybackIntelligence({ ...opts, stateRefs }));
  await act(async () => {});
  expect(fetchContinuationBatch).toHaveBeenCalledWith(
    replacement,
    [replacementTrack],
    expect.any(AbortSignal),
  );
});
