import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePlayerRuntimeState } from "./use-player-runtime-state";
import { usePlaybackPersistence } from "./use-playback-persistence";
import { getStoredQueue, STORAGE_KEY } from "./player-utils";
import type { PlaySource, Track } from "./player-types";
import { getPlaySourceLabel } from "../components/player/player-source";

vi.mock("@/lib/gapless-player", () => ({ initPlayer: vi.fn(() => ({})) }));
const track: Track = { id: "track-1", title: "Marea", artist: "Costa Norte" };
const source: PlaySource = {
  type: "playlist",
  name: "Night Drives",
  id: "night-drives",
  href: "/playlist/night-drives",
};

function useSession() {
  const state = usePlayerRuntimeState();
  usePlaybackPersistence({
    queue: state.queue,
    currentIndex: state.currentIndex,
    isPlaying: state.isPlaying,
    shuffle: state.shuffle,
    playSource: state.playSource,
    queueRef: state.queueRef,
    currentIndexRef: state.currentIndexRef,
    currentTimeRef: state.currentTimeRef,
    isPlayingRef: state.isPlayingRef,
    shuffleRef: state.shuffleRef,
    unshuffledQueueRef: state.unshuffledQueueRef,
  });
  return state;
}

beforeEach(() => {
  localStorage.clear();
  vi.useFakeTimers();
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ queue: [track], currentIndex: 0 }),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

it("restores the same source label and navigation after provider remount, without autoplay", () => {
  const first = renderHook(useSession);
  act(() => first.result.current.setPlaySource(source));
  expect(getStoredQueue().playSource).toEqual(source);
  first.unmount();
  const restored = renderHook(useSession);
  expect(restored.result.current.playSource).toEqual(source);
  expect(restored.result.current.playSourceRef.current).toEqual(source);
  expect(getPlaySourceLabel(restored.result.current.playSource)).toBe(
    "Night Drives",
  );
  expect(restored.result.current.isPlaying).toBe(false);
});

it("persists origin changes even if the queue and cursor do not change", () => {
  const { result } = renderHook(useSession);
  act(() => result.current.setPlaySource(source));
  const queue = result.current.queue;
  const album: PlaySource = {
    type: "album",
    name: "Luz de octubre",
    href: "/artists/costa-norte/luz-de-octubre",
  };
  act(() => result.current.setPlaySource(album));
  expect(result.current.queue).toBe(queue);
  expect(getStoredQueue().playSource).toEqual(album);
});

it("keeps source metadata in checkpoints and unload snapshots without writing on every progress update", () => {
  const { result } = renderHook(useSession);
  act(() => result.current.setPlaySource(source));
  const write = vi.spyOn(Storage.prototype, "setItem");
  act(() => result.current.commitCurrentTime(18));
  expect(write).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(5000));
  expect(getStoredQueue()).toEqual(
    expect.objectContaining({ currentTime: 18, playSource: source }),
  );
  act(() => result.current.commitCurrentTime(27));
  act(() => window.dispatchEvent(new Event("pagehide")));
  expect(getStoredQueue()).toEqual(
    expect.objectContaining({ currentTime: 27, playSource: source }),
  );
  act(() => {
    result.current.commitQueue([]);
    result.current.setPlaySource(null);
  });
  expect(getStoredQueue().playSource).toBeNull();
});
