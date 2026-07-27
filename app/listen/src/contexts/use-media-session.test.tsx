import { renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Track } from "./player-types";
import { useMediaSession } from "./use-media-session";

const runtime = vi.hoisted(() => ({ isNative: false }));

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
  onNativeMediaControl: vi.fn(async () => () => {}),
  stopNativeMediaSession: vi.fn(async () => {}),
  syncNativeMediaSession: vi.fn(async () => {}),
}));

vi.mock("@/lib/platform", () => ({
  isTauriRuntime: false,
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
) {
  return renderHook(
    ({ track, time }: { track: Track | undefined; time: number }) =>
      useMediaSession({
        currentTrack: track,
        isPlaying: true,
        currentTime: time,
        duration: 180,
        ...controls,
      }),
    { initialProps: { track: currentTrack, time: currentTime } },
  );
}

beforeEach(() => {
  runtime.isNative = false;
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
  it("reasserts playing when the active track changes", () => {
    const { rerender } = renderSession();
    expect(mediaSession.playbackState).toBe("playing");

    mediaSession.playbackState = "none";
    rerender({ track: TRACK_B, time: 0 });

    expect(mediaSession.playbackState).toBe("playing");
  });

  it("repairs browser playback state during position updates", () => {
    const { rerender } = renderSession();
    mediaSession.playbackState = "none";

    rerender({ track: TRACK_A, time: 1 });

    expect(mediaSession.playbackState).toBe("playing");
  });

  it("repairs playback state when position reporting is unsupported", () => {
    const { rerender } = renderSession();
    mediaSession.playbackState = "none";
    mediaSession.setPositionState.mockImplementation(() => {
      throw new Error("unsupported");
    });

    rerender({ track: TRACK_A, time: 2 });

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
});
