import { describe, expect, it } from "vitest";

import { createQueueRevision } from "@/lib/playback-engine";
import type {
  EngineErrorEvent,
  EngineEventName,
  EnginePlaybackState,
  EnginePositionEvent,
  EngineQueueSnapshot,
  EngineRepeatMode,
  EngineState,
  EngineTrack,
  EngineTransitionEvent,
  EngineTransitionType,
  PlaybackEngine,
} from "@/lib/playback-engine";

// ── createQueueRevision ───────────────────────────────────────────

describe("createQueueRevision", () => {
  it("returns a non-empty string", () => {
    const rev = createQueueRevision();
    expect(typeof rev).toBe("string");
    expect(rev.length).toBeGreaterThan(0);
  });

  it("produces unique values", () => {
    const a = createQueueRevision();
    const b = createQueueRevision();
    expect(a).not.toBe(b);
  });

  it("uses crypto.randomUUID when available", () => {
    const uuid = "550e8400-e29b-41d4-a716-446655440000";
    const original = globalThis.crypto;
    Object.defineProperty(globalThis, "crypto", {
      value: { randomUUID: () => uuid },
      configurable: true,
    });

    expect(createQueueRevision()).toBe(uuid);

    Object.defineProperty(globalThis, "crypto", {
      value: original,
      configurable: true,
    });
  });

  it("falls back when crypto is unavailable", () => {
    const original = globalThis.crypto;
    // @ts-expect-error - deliberately breaking crypto
    delete globalThis.crypto;

    const rev = createQueueRevision();
    expect(typeof rev).toBe("string");
    expect(rev).toMatch(/^\d+-/);

    Object.defineProperty(globalThis, "crypto", {
      value: original,
      configurable: true,
    });
  });
});

// ── Type shape tests ──────────────────────────────────────────────

describe("EngineTrack", () => {
  it("accepts required and optional fields", () => {
    const track: EngineTrack = {
      id: "t1",
      url: "/stream",
      title: "Title",
      artist: "Artist",
      album: "Album",
      artwork: "/art.jpg",
      durationMs: 180_000,
      storageId: "s1",
      entityUid: "uid-1",
      sourcePath: "/music/track.flac",
      offlineUrl: "/offline/track.flac",
    };

    expect(track.id).toBe("t1");
    expect(track.title).toBe("Title");
  });
});

describe("EngineQueueSnapshot", () => {
  it("accepts all fields", () => {
    const snapshot: EngineQueueSnapshot = {
      revision: "rev-1",
      tracks: [],
      currentIndex: 0,
      positionMs: 0,
      autoplay: false,
      repeat: "off",
      crossfadeMs: 0,
      volume: 1,
    };

    expect(snapshot.revision).toBe("rev-1");
  });
});

describe("EngineState", () => {
  it("accepts all fields", () => {
    const state: EngineState = {
      revision: "rev-1",
      playbackState: "playing",
      isPlaying: true,
      index: 2,
      positionMs: 42_000,
      durationMs: 180_000,
      queueSize: 10,
      crossfadeMs: 4000,
      eqEnabled: false,
    };

    expect(state.playbackState).toBe("playing");
    expect(state.index).toBe(2);
  });
});

describe("EnginePositionEvent", () => {
  it("accepts all fields", () => {
    const event: EnginePositionEvent = {
      revision: "rev-1",
      nativeTimeMs: 100,
      trackId: "t1",
      index: 0,
      positionMs: 15_000,
      durationMs: 200_000,
      isPlaying: true,
    };

    expect(event.positionMs).toBe(15_000);
  });
});

describe("EngineTransitionEvent", () => {
  it("accepts all optional fields", () => {
    const event: EngineTransitionEvent = {
      revision: "rev-1",
      type: "crossfade",
      outgoingTrackId: "t1",
      incomingTrackId: "t2",
      outgoingIndex: 0,
      incomingIndex: 1,
      durationMs: 4000,
      startedAtNativeMs: performance.now(),
      progress: 0.5,
      outgoingVolume: 0.3,
      incomingVolume: 0.7,
      finalIndex: 1,
    };

    expect(event.type).toBe("crossfade");
    expect(event.progress).toBe(0.5);
  });
});

describe("EngineErrorEvent", () => {
  it("accepts all fields", () => {
    const event: EngineErrorEvent = {
      revision: "rev-1",
      code: 4,
      message: "Decode error",
      trackId: "t1",
      url: "/stream",
      cause: "MEDIA_ERROR_DECODE",
      causeMessage: "Failed to decode",
      httpStatus: 500,
    };

    expect(event.message).toBe("Decode error");
    expect(event.httpStatus).toBe(500);
  });
});

// ── Type unions ───────────────────────────────────────────────────

describe("EngineRepeatMode", () => {
  it("accepts valid values", () => {
    const modes: EngineRepeatMode[] = ["off", "one", "all"];
    expect(modes).toHaveLength(3);
  });
});

describe("EnginePlaybackState", () => {
  it("accepts valid values", () => {
    const states: EnginePlaybackState[] = [
      "idle",
      "buffering",
      "ready",
      "playing",
      "paused",
      "ended",
    ];
    expect(states).toHaveLength(6);
  });
});

describe("EngineTransitionType", () => {
  it("accepts valid values", () => {
    const types: EngineTransitionType[] = [
      "gapless",
      "crossfade",
      "manual-skip",
      "seek",
    ];
    expect(types).toHaveLength(4);
  });
});

// ── EngineEventMap structure ──────────────────────────────────────

describe("EngineEventMap", () => {
  it("has all expected event keys", () => {
    const keys: EngineEventName[] = [
      "ready",
      "stateChanged",
      "positionChanged",
      "playEventCheckpoint",
      "trackChanged",
      "transitionStarted",
      "transitionProgress",
      "transitionEnded",
      "bufferingChanged",
      "queueEnded",
      "nearQueueEnd",
      "error",
    ];

    // Type-level assertion: the array must satisfy EngineEventName[]
    // Runtime check that it's not empty and covers the core events.
    expect(keys.length).toBeGreaterThanOrEqual(8);
    expect(keys).toContain("positionChanged");
    expect(keys).toContain("error");
    expect(keys).toContain("queueEnded");
  });
});

// ── PlaybackEngine interface ──────────────────────────────────────

describe("PlaybackEngine interface shape", () => {
  it("requires all methods on implementations", () => {
    const methods: (keyof PlaybackEngine)[] = [
      "loadQueue",
      "play",
      "pause",
      "stop",
      "seekTo",
      "next",
      "previous",
      "jumpTo",
      "appendTracks",
      "insertTrack",
      "removeTrack",
      "reorderTrack",
      "setRepeat",
      "setCrossfadeMs",
      "setVolume",
      "setPlaybackRate",
      "setEq",
      "getState",
      "drainEvents",
      "on",
      "destroy",
    ];

    expect(methods).toHaveLength(21);
  });
});
