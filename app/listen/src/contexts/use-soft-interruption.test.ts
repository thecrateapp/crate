import { renderHook, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock gapless-player — the hook only touches these exports.
vi.mock("@/lib/gapless-player", () => ({
  fadeInAndPlay: vi.fn(() => Promise.resolve()),
  fadeOutAndPause: vi.fn(() => Promise.resolve()),
  getPosition: vi.fn(() => 0),
  play: vi.fn(),
  pause: vi.fn(),
  restoreVolume: vi.fn(),
  getCurrentBufferedAheadSeconds: vi.fn(() => 0),
  // Default: track is NOT fully buffered in RAM, so interruption paths
  // proceed normally. Tests that want to exercise the "fully buffered"
  // short-circuit override this per-case.
  isCurrentTrackFullyBuffered: vi.fn(() => false),
}));

// Mock capacitor online check while keeping the rest of the module shape
// intact for consumers that depend on isNative/platform helpers.
vi.mock(import("@/lib/capacitor"), async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    isOnline: vi.fn(() => Promise.resolve(true)),
  };
});

vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: vi.fn(() => false),
  androidNativeEngine: {
    pause: vi.fn(() => Promise.resolve()),
    play: vi.fn(() => Promise.resolve()),
  },
}));

import * as gaplessPlayer from "@/lib/gapless-player";
import * as capacitor from "@/lib/capacitor";
import * as nativeEngine from "@/lib/android-native-engine";
import {
  PLAYBACK_NEEDS_USER_GESTURE_EVENT,
  useSoftInterruption,
} from "./use-soft-interruption";
import type { MutableRefObject } from "react";
import type { Track } from "./player-types";

const mockFadeOutAndPause = vi.mocked(gaplessPlayer.fadeOutAndPause);
const mockIsOnline = vi.mocked(capacitor.isOnline);
const mockUseNativePlayer = vi.mocked(
  nativeEngine.shouldUseAndroidNativePlayer,
);
const mockNativePause = vi.mocked(nativeEngine.androidNativeEngine.pause);

function serverDown() {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: false, status: 503, body: null } as Response),
  ) as typeof fetch;
}

function serverUp() {
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 206, body: null } as Response),
  ) as typeof fetch;
}
const globalFetch = global.fetch;

const TRACK: Track = { id: "t1", title: "Test", artist: "Artist" };

function createRefs(
  overrides: {
    currentTrack?: Track | undefined;
    isPlaying?: boolean;
    isBuffering?: boolean;
    bufferingIntent?: boolean;
    onPlaybackStall?: () => void;
    onPlaybackStallEnded?: (
      durationMs: number,
      bufferedAheadSeconds: number,
    ) => void;
    onPlaybackRecovered?: (attempt: number) => void;
    recoverCurrentTrack?: () => Promise<boolean>;
  } = {},
) {
  const has = (k: keyof typeof overrides) =>
    Object.prototype.hasOwnProperty.call(overrides, k);
  const refs = {
    currentTrackRef: {
      current: has("currentTrack") ? overrides.currentTrack : TRACK,
    } as MutableRefObject<Track | undefined>,
    isPlayingRef: {
      current: overrides.isPlaying ?? true,
    } as MutableRefObject<boolean>,
    isBufferingRef: {
      current: overrides.isBuffering ?? false,
    } as MutableRefObject<boolean>,
    bufferingIntentRef: {
      current: overrides.bufferingIntent ?? false,
    } as MutableRefObject<boolean>,
    commitIsPlaying: vi.fn(),
    commitIsBuffering: vi.fn(),
    onPlaybackStall: overrides.onPlaybackStall,
    onPlaybackStallEnded: overrides.onPlaybackStallEnded,
    onPlaybackRecovered: overrides.onPlaybackRecovered,
    recoverCurrentTrack: overrides.recoverCurrentTrack,
  };
  return refs;
}

beforeEach(() => {
  vi.useFakeTimers();
  mockFadeOutAndPause.mockClear();
  mockIsOnline.mockClear();
  mockIsOnline.mockResolvedValue(true);
  global.fetch = vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, body: null } as Response),
  ) as typeof fetch;
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
  global.fetch = globalFetch;
  // Clear call histories first, then restore default behavior for
  // stateful mocks so each test starts with a clean slate.
  vi.clearAllMocks();
  vi.mocked(gaplessPlayer.isCurrentTrackFullyBuffered).mockReturnValue(false);
  vi.mocked(gaplessPlayer.getCurrentBufferedAheadSeconds).mockReturnValue(0);
  mockUseNativePlayer.mockReturnValue(false);
});

describe("useSoftInterruption", () => {
  it("exposes an initial not-interrupted state", () => {
    const refs = createRefs();
    const { result } = renderHook(() => useSoftInterruption(refs));
    expect(result.current.isSoftInterrupted()).toBe(false);
  });

  it("beginSoftInterruption pauses with fade when playing", async () => {
    const refs = createRefs({ isPlaying: true });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.beginSoftInterruption("stream");
    });

    expect(result.current.isSoftInterrupted()).toBe(true);
    expect(refs.commitIsBuffering).toHaveBeenCalledWith(true);
    expect(mockFadeOutAndPause).toHaveBeenCalled();
    expect(refs.bufferingIntentRef.current).toBe(false);
  });

  it("records one quality stall for a single interrupted track", () => {
    const onPlaybackStall = vi.fn();
    const refs = createRefs({ onPlaybackStall });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.beginSoftInterruption("stream");
      result.current.beginSoftInterruption("stream");
    });

    expect(onPlaybackStall).toHaveBeenCalledOnce();
  });

  it("refreshes only the active source after two failed recovery probes", async () => {
    const recoverCurrentTrack = vi.fn(async () => true);
    const onPlaybackRecovered = vi.fn();
    global.fetch = vi.fn(() =>
      Promise.resolve({ ok: false, status: 401, body: null } as Response),
    ) as typeof fetch;
    const refs = createRefs({ recoverCurrentTrack, onPlaybackRecovered });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.beginSoftInterruption("stream");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
      await vi.advanceTimersByTimeAsync(3_100);
    });

    expect(recoverCurrentTrack).toHaveBeenCalledOnce();
    expect(onPlaybackRecovered).toHaveBeenCalledWith(2);
  });

  it("beginSoftInterruption hard-pauses when not playing", () => {
    const refs = createRefs({ isPlaying: false });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.beginSoftInterruption("offline");
    });

    expect(gaplessPlayer.pause).toHaveBeenCalled();
    expect(mockFadeOutAndPause).not.toHaveBeenCalled();
  });

  it("beginSoftInterruption is a no-op when there's no current track", () => {
    const refs = createRefs({ currentTrack: undefined });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.beginSoftInterruption("stream");
    });

    expect(result.current.isSoftInterrupted()).toBe(false);
    expect(refs.commitIsBuffering).not.toHaveBeenCalled();
  });

  it("cancelSoftInterruption resets state", () => {
    const onPlaybackStallEnded = vi.fn();
    const refs = createRefs({ onPlaybackStallEnded });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.beginSoftInterruption("stream");
    });
    expect(result.current.isSoftInterrupted()).toBe(true);

    act(() => {
      vi.advanceTimersByTime(240);
      result.current.cancelSoftInterruption();
    });
    expect(result.current.isSoftInterrupted()).toBe(false);
    expect(onPlaybackStallEnded).toHaveBeenCalledWith(240, 0);
  });

  it("requireUserGestureToResume stops automatic recovery and emits a resume event", () => {
    const refs = createRefs();
    const listener = vi.fn();
    window.addEventListener("crate:playback-needs-user-gesture", listener);
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.beginSoftInterruption("stream");
    });
    act(() => {
      result.current.requireUserGestureToResume();
    });
    act(() => {
      vi.advanceTimersByTime(3100);
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(refs.commitIsPlaying).toHaveBeenCalledWith(false);
    expect(refs.commitIsBuffering).toHaveBeenLastCalledWith(false);
    expect(gaplessPlayer.fadeInAndPlay).not.toHaveBeenCalled();

    window.removeEventListener("crate:playback-needs-user-gesture", listener);
  });

  it("upgrades stream interruption to offline if detected later", () => {
    const refs = createRefs();
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.beginSoftInterruption("stream");
    });
    act(() => {
      result.current.beginSoftInterruption("offline");
    });

    // Both calls succeed; second call doesn't re-pause but does upgrade
    // the reason internally. We can't inspect the reason from outside,
    // but the state is still interrupted.
    expect(result.current.isSoftInterrupted()).toBe(true);
  });

  it("scheduleStallProtection arms a timer that triggers on stall", async () => {
    const refs = createRefs({ isPlaying: true });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.scheduleStallProtection();
    });
    expect(result.current.isSoftInterrupted()).toBe(false);

    // Fast-forward past STREAM_STALL_GRACE_MS (2500ms).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });
    expect(result.current.isSoftInterrupted()).toBe(true);
  });

  it("scheduleStallProtection skips when bufferingIntent is active", () => {
    const refs = createRefs({ isPlaying: true, bufferingIntent: true });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.scheduleStallProtection();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.isSoftInterrupted()).toBe(false);
  });

  it("scheduleStallProtection skips when not playing", () => {
    const refs = createRefs({ isPlaying: false });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.scheduleStallProtection();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.isSoftInterrupted()).toBe(false);
  });

  it("clearStallTimer cancels a pending stall", () => {
    const refs = createRefs({ isPlaying: true });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.scheduleStallProtection();
    });
    act(() => {
      result.current.clearStallTimer();
    });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.isSoftInterrupted()).toBe(false);
  });

  it("responds to browser offline event while playing", async () => {
    const refs = createRefs({ isPlaying: true });
    renderHook(() => useSoftInterruption(refs));

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    // beginSoftInterruption is called, which triggers commitIsBuffering.
    expect(refs.commitIsBuffering).toHaveBeenCalledWith(true);
  });

  it("ignores offline event when not playing and not buffering", () => {
    const refs = createRefs({ isPlaying: false, isBuffering: false });
    renderHook(() => useSoftInterruption(refs));

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(refs.commitIsBuffering).not.toHaveBeenCalled();
  });

  it("does NOT pause on offline when the current track is fully buffered in RAM", () => {
    vi.mocked(gaplessPlayer.isCurrentTrackFullyBuffered).mockReturnValue(true);
    const refs = createRefs({ isPlaying: true });
    renderHook(() => useSoftInterruption(refs));

    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    // No interruption triggered — audio keeps playing from RAM.
    expect(refs.commitIsBuffering).not.toHaveBeenCalled();
    expect(gaplessPlayer.fadeOutAndPause).not.toHaveBeenCalled();
    expect(gaplessPlayer.pause).not.toHaveBeenCalled();
  });

  it("beginSoftInterruption short-circuits when fully buffered", () => {
    vi.mocked(gaplessPlayer.isCurrentTrackFullyBuffered).mockReturnValue(true);
    const refs = createRefs({ isPlaying: true });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.beginSoftInterruption("stream");
    });

    expect(result.current.isSoftInterrupted()).toBe(false);
    expect(gaplessPlayer.fadeOutAndPause).not.toHaveBeenCalled();
    expect(refs.commitIsBuffering).not.toHaveBeenCalled();
  });

  it("keeps playing when the live source has a safe buffer ahead", () => {
    vi.mocked(gaplessPlayer.getCurrentBufferedAheadSeconds).mockReturnValue(5);
    const refs = createRefs({ isPlaying: true });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.beginSoftInterruption("stream");
    });

    expect(result.current.isSoftInterrupted()).toBe(false);
    expect(gaplessPlayer.fadeOutAndPause).not.toHaveBeenCalled();
  });

  it("waits for the remaining buffer to become critical before recovery", async () => {
    vi.mocked(gaplessPlayer.getCurrentBufferedAheadSeconds).mockReturnValue(3);
    const refs = createRefs({ isPlaying: true });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.scheduleStallProtection();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });

    expect(result.current.isSoftInterrupted()).toBe(false);
    vi.mocked(gaplessPlayer.getCurrentBufferedAheadSeconds).mockReturnValue(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2600);
    });

    expect(result.current.isSoftInterrupted()).toBe(true);
  });

  it("cleans up timers on unmount", () => {
    const refs = createRefs({ isPlaying: true });
    const { result, unmount } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.scheduleStallProtection();
    });
    unmount();

    // After unmount, advancing timers should not invoke anything
    // — refs.commitIsBuffering stays at whatever it was.
    const before = refs.commitIsBuffering.mock.calls.length;
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(refs.commitIsBuffering.mock.calls.length).toBe(before);
  });

  it("does not auto-retry playback after returning from background", async () => {
    const refs = createRefs({ isPlaying: true, isBuffering: true });
    renderHook(() => useSoftInterruption(refs));

    act(() => {
      window.dispatchEvent(new CustomEvent("crate:app-paused"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(9_000);
      window.dispatchEvent(new CustomEvent("crate:app-resumed"));
    });

    expect(gaplessPlayer.play).not.toHaveBeenCalled();
    expect(global.fetch).not.toHaveBeenCalled();
    expect(refs.commitIsBuffering).toHaveBeenCalledWith(false);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600);
    });

    expect(refs.commitIsBuffering).not.toHaveBeenCalledWith(true);
    expect(mockFadeOutAndPause).not.toHaveBeenCalled();
  });

  it("keeps stream recovery armed when the page is merely hidden", async () => {
    const refs = createRefs({ isPlaying: true });
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.beginSoftInterruption("stream");
    });
    expect(result.current.isSoftInterrupted()).toBe(true);

    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3_100);
    });

    expect(global.fetch).toHaveBeenCalled();
    expect(gaplessPlayer.fadeInAndPlay).toHaveBeenCalled();
  });

  describe("with the Android native player", () => {
    beforeEach(() => {
      mockUseNativePlayer.mockReturnValue(true);
    });

    it("keeps native playback running on an offline event", () => {
      const refs = createRefs({ isPlaying: true });
      const { result } = renderHook(() => useSoftInterruption(refs));

      act(() => {
        window.dispatchEvent(new Event("offline"));
      });

      expect(mockNativePause).not.toHaveBeenCalled();
      expect(refs.commitIsBuffering).not.toHaveBeenCalled();
      expect(result.current.isSoftInterrupted()).toBe(false);
    });

    it("does not spend recovery attempts while the device is offline", async () => {
      const recoverCurrentTrack = vi.fn(async () => true);
      const onPlaybackRecovered = vi.fn();
      mockIsOnline.mockResolvedValue(false);
      const refs = createRefs({ recoverCurrentTrack, onPlaybackRecovered });
      const { result } = renderHook(() => useSoftInterruption(refs));

      act(() => {
        result.current.beginSoftInterruption("stream");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_100);
        window.dispatchEvent(new Event("offline"));
        window.dispatchEvent(new Event("offline"));
        await vi.advanceTimersByTimeAsync(20_000);
      });
      expect(global.fetch).not.toHaveBeenCalled();
      expect(recoverCurrentTrack).not.toHaveBeenCalled();

      mockIsOnline.mockResolvedValue(true);
      serverUp();
      await act(async () => {
        window.dispatchEvent(new Event("online"));
        await vi.advanceTimersByTimeAsync(10);
      });

      expect(recoverCurrentTrack).toHaveBeenCalledOnce();
      expect(onPlaybackRecovered).toHaveBeenCalledWith(0);
      expect(result.current.isSoftInterrupted()).toBe(false);
    });

    it("reloads the failed deck instead of resuming it when the server answers", async () => {
      const recoverCurrentTrack = vi.fn(async () => true);
      const refs = createRefs({ recoverCurrentTrack });
      const { result } = renderHook(() => useSoftInterruption(refs));

      act(() => {
        result.current.beginSoftInterruption("stream");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_100);
      });

      expect(recoverCurrentTrack).toHaveBeenCalledOnce();
      expect(nativeEngine.androidNativeEngine.play).not.toHaveBeenCalled();
      expect(result.current.isSoftInterrupted()).toBe(false);
    });

    it("treats an unauthorized probe as a reachable server and reloads", async () => {
      const recoverCurrentTrack = vi.fn(async () => true);
      global.fetch = vi.fn(() =>
        Promise.resolve({ ok: false, status: 401, body: null } as Response),
      ) as typeof fetch;
      const refs = createRefs({ recoverCurrentTrack });
      const { result } = renderHook(() => useSoftInterruption(refs));

      act(() => {
        result.current.beginSoftInterruption("stream");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(3_100);
      });

      expect(recoverCurrentTrack).toHaveBeenCalledOnce();
      expect(result.current.isSoftInterrupted()).toBe(false);
    });

    it("keeps retrying every 30s after the fast attempts while the server is down", async () => {
      const recoverCurrentTrack = vi.fn(async () => false);
      const gestureRequired = vi.fn();
      window.addEventListener(
        PLAYBACK_NEEDS_USER_GESTURE_EVENT,
        gestureRequired,
      );
      serverDown();
      const refs = createRefs({ recoverCurrentTrack });
      const { result } = renderHook(() => useSoftInterruption(refs));

      act(() => {
        result.current.beginSoftInterruption("stream");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(12_100);
      });
      expect(global.fetch).toHaveBeenCalledTimes(4);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(29_000);
      });
      expect(global.fetch).toHaveBeenCalledTimes(4);

      recoverCurrentTrack.mockResolvedValue(true);
      serverUp();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_100);
      });

      expect(recoverCurrentTrack).toHaveBeenCalledTimes(3);
      expect(gestureRequired).not.toHaveBeenCalled();
      expect(result.current.isSoftInterrupted()).toBe(false);
      window.removeEventListener(
        PLAYBACK_NEEDS_USER_GESTURE_EVENT,
        gestureRequired,
      );
    });

    it("gives up after five minutes and re-arms when the network returns", async () => {
      const recoverCurrentTrack = vi.fn(async () => false);
      const gestureRequired = vi.fn();
      window.addEventListener(
        PLAYBACK_NEEDS_USER_GESTURE_EVENT,
        gestureRequired,
      );
      serverDown();
      const refs = createRefs({ recoverCurrentTrack });
      const { result } = renderHook(() => useSoftInterruption(refs));

      act(() => {
        result.current.beginSoftInterruption("stream");
      });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(6 * 60_000);
      });
      expect(gestureRequired).toHaveBeenCalledOnce();

      recoverCurrentTrack.mockResolvedValue(true);
      serverUp();
      await act(async () => {
        window.dispatchEvent(new CustomEvent("crate:network-restored"));
        await vi.advanceTimersByTimeAsync(10);
      });

      expect(recoverCurrentTrack).toHaveBeenLastCalledWith();
      expect(result.current.isSoftInterrupted()).toBe(false);
      window.removeEventListener(
        PLAYBACK_NEEDS_USER_GESTURE_EVENT,
        gestureRequired,
      );
    });
  });

  it("asks for a gesture after the fast attempts on the web player", async () => {
    const gestureRequired = vi.fn();
    window.addEventListener(PLAYBACK_NEEDS_USER_GESTURE_EVENT, gestureRequired);
    serverDown();
    const refs = createRefs();
    const { result } = renderHook(() => useSoftInterruption(refs));

    act(() => {
      result.current.beginSoftInterruption("stream");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12_100);
    });

    expect(gestureRequired).toHaveBeenCalledOnce();
    await act(async () => {
      window.dispatchEvent(new Event("online"));
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(global.fetch).toHaveBeenCalledTimes(4);
    window.removeEventListener(
      PLAYBACK_NEEDS_USER_GESTURE_EVENT,
      gestureRequired,
    );
  });
});
