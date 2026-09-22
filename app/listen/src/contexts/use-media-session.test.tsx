import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { NativeMediaControlEvent } from "@/lib/native-media-session-bridge";

import type { Track } from "./player-types";
import { useMediaSession } from "./use-media-session";

const runtime = vi.hoisted(() => ({ isNative: false }));
const audioOutput = vi.hoisted(() => ({ interruptionPending: false }));
const nativeMediaSession = vi.hoisted(() => ({
  cancelPendingResume: vi.fn(async () => {}),
  controlListener: null as ((event: NativeMediaControlEvent) => void) | null,
  resumeAllowed: true,
}));

vi.mock("@/lib/capacitor-runtime", () => ({
  get isNative() {
    return runtime.isNative;
  },
}));

vi.mock("@/lib/android-native-engine", () => ({
  shouldUseAndroidNativePlayer: () => false,
}));

vi.mock("@/lib/api", () => ({
  resolveMaybeApiAssetUrl: (value: string | undefined) => value ?? "",
}));

vi.mock("@/lib/desktop-tray", () => ({
  syncDesktopMediaSession: vi.fn(),
}));

vi.mock("@/lib/native-media-session", () => ({
  cancelNativeMediaSessionResume: nativeMediaSession.cancelPendingResume,
  onNativeMediaControl: vi.fn(
    async (listener: (event: NativeMediaControlEvent) => void) => {
      nativeMediaSession.controlListener = listener;
      return () => {
        nativeMediaSession.controlListener = null;
      };
    },
  ),
  markNativeMediaSessionPlayingIntent: vi.fn(),
  shouldResumeAfterNativeInterruption: () => nativeMediaSession.resumeAllowed,
  stopNativeMediaSession: vi.fn(async () => {}),
  syncNativeMediaSession: vi.fn(async () => {}),
}));

vi.mock("@/lib/platform", () => ({
  isTauriRuntime: false,
}));

vi.mock("@/lib/audio-output-interruption", () => ({
  isAudioOutputInterruptionPending: () => audioOutput.interruptionPending,
}));

const TRACK_A: Track = {
  id: "track-a",
  title: "Track A",
  artist: "Artist",
  album: "Album",
};

const TRACK_B: Track = {
  ...TRACK_A,
  id: "track-b",
  title: "Track B",
};

const controls = {
  pause: vi.fn(),
  resume: vi.fn(),
  next: vi.fn(),
  prev: vi.fn(),
  seek: vi.fn(),
};

type MutableMediaSession = {
  metadata: MediaMetadata | null;
  playbackState: MediaSessionPlaybackState;
  setActionHandler: ReturnType<typeof vi.fn>;
  setPositionState: ReturnType<typeof vi.fn>;
};

let mediaSession: MutableMediaSession;
let originalMediaSession: PropertyDescriptor | undefined;
let originalMediaMetadata: PropertyDescriptor | undefined;

function renderSession(
  currentTrack: Track | undefined = TRACK_A,
  currentTime = 0,
  isPlaying = true,
) {
  return renderHook(
    ({
      track,
      time,
      playing,
    }: {
      track: Track | undefined;
      time: number;
      playing: boolean;
    }) =>
      useMediaSession({
        currentTrack: track,
        isPlaying: playing,
        currentTime: time,
        duration: 180,
        ...controls,
      }),
    {
      initialProps: {
        track: currentTrack,
        time: currentTime,
        playing: isPlaying,
      },
    },
  );
}

function getMediaSessionActionHandler(
  action: MediaSessionAction,
): MediaSessionActionHandler {
  const registration = mediaSession.setActionHandler.mock.calls.find(
    ([registeredAction]) => registeredAction === action,
  );
  expect(registration).toBeDefined();
  return registration?.[1] as MediaSessionActionHandler;
}

beforeEach(() => {
  runtime.isNative = false;
  audioOutput.interruptionPending = false;
  nativeMediaSession.controlListener = null;
  nativeMediaSession.resumeAllowed = true;
  vi.clearAllMocks();
  mediaSession = {
    metadata: null,
    playbackState: "none",
    setActionHandler: vi.fn(),
    setPositionState: vi.fn(),
  };
  originalMediaSession = Object.getOwnPropertyDescriptor(
    navigator,
    "mediaSession",
  );
  originalMediaMetadata = Object.getOwnPropertyDescriptor(
    globalThis,
    "MediaMetadata",
  );
  Object.defineProperty(navigator, "mediaSession", {
    configurable: true,
    value: mediaSession,
  });
  Object.defineProperty(globalThis, "MediaMetadata", {
    configurable: true,
    value: class {
      constructor(public init: MediaMetadataInit) {}
    },
  });
});

afterEach(() => {
  if (originalMediaSession) {
    Object.defineProperty(navigator, "mediaSession", originalMediaSession);
  } else {
    Reflect.deleteProperty(navigator, "mediaSession");
  }
  if (originalMediaMetadata) {
    Object.defineProperty(globalThis, "MediaMetadata", originalMediaMetadata);
  } else {
    Reflect.deleteProperty(globalThis, "MediaMetadata");
  }
});

describe("useMediaSession", () => {
  it("does not duplicate an interruption controller resume from a browser play action", () => {
    audioOutput.interruptionPending = true;
    renderSession(TRACK_A, 0, false);

    getMediaSessionActionHandler("play")({ action: "play" });

    expect(controls.resume).not.toHaveBeenCalled();
  });

  it("does not restart playback when the browser repeats play for an active track", () => {
    renderSession(TRACK_A, 0, true);

    getMediaSessionActionHandler("play")({ action: "play" });

    expect(controls.resume).not.toHaveBeenCalled();
  });

  it("requests an immediate pause from the Web MediaSession handler", () => {
    renderSession();

    getMediaSessionActionHandler("pause")({ action: "pause" });

    expect(controls.pause).toHaveBeenCalledWith({
      immediate: true,
      preserveAudioOutputResume: true,
    });
  });

  it("synchronizes the Web MediaSession state inside the pause callback", () => {
    renderSession();
    expect(mediaSession.playbackState).toBe("playing");

    getMediaSessionActionHandler("pause")({ action: "pause" });

    expect(mediaSession.playbackState).toBe("paused");
  });

  it("reasserts playing when the active track changes", () => {
    const { rerender } = renderSession();
    expect(mediaSession.playbackState).toBe("playing");

    mediaSession.playbackState = "none";
    rerender({ track: TRACK_B, time: 0, playing: true });

    expect(mediaSession.playbackState).toBe("playing");
  });

  it("repairs browser playback state during position updates", () => {
    const { rerender } = renderSession();
    mediaSession.playbackState = "none";

    rerender({ track: TRACK_A, time: 1, playing: true });

    expect(mediaSession.playbackState).toBe("playing");
  });

  it("repairs playback state when position reporting is unsupported", () => {
    const { rerender } = renderSession();
    mediaSession.playbackState = "none";
    mediaSession.setPositionState.mockImplementation(() => {
      throw new Error("unsupported");
    });

    rerender({ track: TRACK_A, time: 2, playing: true });

    expect(mediaSession.playbackState).toBe("playing");
  });

  it("does not create a competing WebView media session in native shells", () => {
    runtime.isNative = true;

    renderSession();

    expect(mediaSession.metadata).toBeNull();
    expect(mediaSession.playbackState).toBe("none");
    expect(mediaSession.setActionHandler).not.toHaveBeenCalled();
    expect(mediaSession.setPositionState).not.toHaveBeenCalled();
  });

  it("restores metadata when Android Chrome acquires audio focus on play", () => {
    const { rerender } = renderSession(TRACK_A, 0, false);
    mediaSession.metadata = null;

    rerender({ track: TRACK_A, time: 0, playing: true });

    expect(mediaSession.metadata).not.toBeNull();
    expect(mediaSession.playbackState).toBe("playing");
  });

  it("preserves native interruption resume for the pause requested by iOS", async () => {
    runtime.isNative = true;
    const { rerender } = renderSession(TRACK_A, 0, true);
    await vi.waitFor(() => {
      expect(nativeMediaSession.controlListener).not.toBeNull();
    });

    nativeMediaSession.controlListener?.({
      control: "pause",
      source: "audio-interruption",
    });
    rerender({ track: TRACK_A, time: 0, playing: false });

    expect(controls.pause).toHaveBeenCalledTimes(1);
    expect(controls.pause).toHaveBeenCalledWith({ preserveNativeResume: true });
    expect(nativeMediaSession.cancelPendingResume).not.toHaveBeenCalled();
  });

  it("ignores an interruption resume invalidated by an explicit pause", async () => {
    runtime.isNative = true;
    nativeMediaSession.resumeAllowed = false;
    renderSession(TRACK_A, 0, false);
    await vi.waitFor(() => {
      expect(nativeMediaSession.controlListener).not.toBeNull();
    });

    nativeMediaSession.controlListener?.({
      control: "play",
      source: "audio-interruption-resume",
    });

    expect(controls.resume).not.toHaveBeenCalled();
  });
});
