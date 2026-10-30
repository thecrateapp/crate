import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Track } from "./player-types";

const engine = vi.hoisted(() => ({
  play: vi.fn(),
  fadeInAndPlay: vi.fn(),
}));
vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => false,
  androidNativeEngine: {},
}));
vi.mock("@/lib/capacitor-runtime", () => ({ isNative: false }));
vi.mock("@/lib/gapless-player", () => ({
  play: engine.play,
  fadeInAndPlay: engine.fadeInAndPlay,
  fadeOutAndPause: vi.fn(),
  pause: vi.fn(),
  restoreVolume: vi.fn(),
  seekTo: vi.fn(),
  setPlaybackRate: vi.fn(),
  setVolume: vi.fn(),
}));
vi.mock("@/lib/cast-sender", () => ({
  castPause: vi.fn(),
  castPlay: vi.fn(),
  castSeek: vi.fn(),
  castSetVolume: vi.fn(),
  isCastSessionActive: () => false,
}));
vi.mock("@/lib/native-media-session", () => ({
  cancelNativeMediaSessionResume: vi.fn(),
  markNativeMediaSessionPlayingIntent: vi.fn(),
}));

import { usePlayerTransportControls } from "./use-player-transport-controls";

const methods = [
  ["resume", "visible"],
  ["resume", "hidden"],
  ["resumeLocal", "visible"],
  ["resumeLocal", "hidden"],
] as const;
const lastTrack: Track = { id: "last", title: "Last", artist: "Artist" };
function setup() {
  const options = {
    resumePendingQueue: vi.fn(() => false),
    resumePlaybackIntelligence: vi.fn<
      (intent?: { userGesture?: boolean }) => boolean | void
    >(() => false),
    queueRef: { current: [lastTrack] },
    isPlayingRef: { current: false },
    bufferingIntentRef: { current: false },
    lastNonZeroVolumeRef: { current: 0.8 },
    commitIsPlaying: vi.fn(),
    commitIsBuffering: vi.fn(),
    commitCurrentTime: vi.fn(),
    setVolumeState: vi.fn(),
    markSeekPosition: vi.fn(),
    cancelSoftInterruption: vi.fn(),
    silenceGaplessEngine: vi.fn(),
  };
  return { ...renderHook(() => usePlayerTransportControls(options)), options };
}
beforeEach(() => {
  vi.clearAllMocks();
  engine.play.mockResolvedValue("applied");
  engine.fadeInAndPlay.mockResolvedValue("applied");
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    value: "visible",
  });
});

describe("transport Resume at EOF", () => {
  it.each(methods)(
    "%s in a %s page lets refill consume the gesture without replaying the finished track",
    async (method, visibility) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: visibility,
      });
      const { result, options } = setup();
      options.resumePlaybackIntelligence.mockReturnValue(true);

      await act(async () => result.current[method]());

      expect(engine.play).not.toHaveBeenCalled();
      expect(engine.fadeInAndPlay).not.toHaveBeenCalled();
      expect(
        options.resumePlaybackIntelligence,
      ).toHaveBeenCalledExactlyOnceWith({ userGesture: true });
      expect(options.queueRef.current).toEqual([lastTrack]);
    },
  );

  it.each(methods)(
    "%s in a %s page preserves ordinary playback when refill does not consume the gesture",
    async (method, visibility) => {
      Object.defineProperty(document, "visibilityState", {
        configurable: true,
        value: visibility,
      });
      const { result } = setup();

      await act(async () => result.current[method]());

      if (visibility === "hidden") {
        expect(engine.play).toHaveBeenCalledOnce();
        expect(engine.fadeInAndPlay).not.toHaveBeenCalled();
      } else {
        expect(engine.fadeInAndPlay).toHaveBeenCalledOnce();
        expect(engine.play).not.toHaveBeenCalled();
      }
    },
  );

  it("lets pending queue preparation consume Resume before attempting refill or playing the old queue", async () => {
    const { result, options } = setup();
    options.resumePendingQueue.mockReturnValue(true);

    await act(async () => result.current.resume());

    expect(options.resumePlaybackIntelligence).not.toHaveBeenCalled();
    expect(engine.play).not.toHaveBeenCalled();
    expect(engine.fadeInAndPlay).not.toHaveBeenCalled();
  });
});
