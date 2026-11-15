import { describe, expect, it, vi } from "vitest";

import type { AudioRecoveryController } from "./gapless-player-audio-recovery";
import { createGaplessPlayerControls } from "./gapless-player-controls";
import type { Gapless5 } from "@/lib/gapless5/gapless5";

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function createPlayer() {
  return {
    currentLength: vi.fn(() => 180_000),
    getCurrentBufferedAheadSeconds: vi.fn(() => 7.5),
    getIndex: vi.fn(() => 1),
    getPosition: vi.fn(() => 42_000),
    getTrack: vi.fn(() => "/tracks/current.flac"),
    getTracks: vi.fn(() => ["/tracks/a.flac", "/tracks/b.flac"]),
    getVolume: vi.fn(),
    gotoTrack: vi.fn(),
    isShuffled: vi.fn(() => false),
    next: vi.fn(),
    pause: vi.fn(),
    prev: vi.fn(),
    play: vi.fn(),
    setCrossfade: vi.fn(),
    setPlaybackRate: vi.fn(),
    setPosition: vi.fn(),
    setVolume: vi.fn(),
    shuffle: vi.fn(),
    stop: vi.fn(),
    toggleShuffle: vi.fn(),
    loop: false,
    singleMode: false,
  };
}

interface ControlsFixtureOptions {
  audioContextState?: AudioContextState;
  isTauriDesktopRuntime?: boolean;
  prepare?: () => Promise<void>;
  recoveryRequired?: boolean;
}

function createControls(options: ControlsFixtureOptions = {}) {
  const player = createPlayer();
  const typedPlayer = player as unknown as Gapless5;
  const prepare = vi.fn(options.prepare ?? (async () => undefined));
  const needsRecovery = vi.fn(() => options.recoveryRequired ?? false);
  const audioRecovery = {
    install: vi.fn(),
    reset: vi.fn(),
    needsRecovery,
    prepare,
  };
  const audioContext = options.audioContextState
    ? ({ state: options.audioContextState } as AudioContext)
    : null;
  const host = {
    audioRecovery: audioRecovery as unknown as AudioRecoveryController,
    getAudioContext: vi.fn(() => audioContext),
    getCrossfadeDurationMs: vi.fn(() => 4_000),
    getLastPlaybackRate: vi.fn(() => 1),
    getLastVolume: vi.fn(() => 0.8),
    getPlayer: vi.fn(() => typedPlayer),
    isTauriDesktopRuntime: vi.fn(() => options.isTauriDesktopRuntime ?? false),
    setLastPlaybackRate: vi.fn(),
    setPlaybackActive: vi.fn(),
  };

  return {
    audioRecovery,
    controls: createGaplessPlayerControls(host),
    host,
    player,
  };
}

describe("gapless player controls", () => {
  it("delegates playback commands through the recovery boundary", async () => {
    const { controls, host, player } = createControls();

    await controls.play();
    controls.next();
    controls.gotoTrack(0, true);

    expect(host.audioRecovery.prepare).toHaveBeenCalledWith("play", {
      rebuildIfTauriOutputMayBeStale: true,
    });
    expect(host.audioRecovery.prepare).toHaveBeenCalledWith("next", {
      rebuildIfTauriOutputMayBeStale: true,
    });
    expect(host.audioRecovery.prepare).toHaveBeenCalledWith("gotoTrack", {
      rebuildIfTauriOutputMayBeStale: true,
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(player.play).toHaveBeenCalledTimes(1);
    expect(player.next).toHaveBeenCalledWith(undefined, true, true);
    expect(player.gotoTrack).toHaveBeenCalledWith(0, true);
  });

  it("keeps player state reads and playback settings behind the host", () => {
    const { controls, host, player } = createControls();

    expect(controls.getPosition()).toBe(42_000);
    expect(controls.getCurrentTrackDuration()).toBe(180_000);
    expect(controls.getCurrentTrackUrl()).toBe("/tracks/current.flac");
    expect(controls.getTrackIndex()).toBe(1);
    expect(controls.getTracks()).toEqual(["/tracks/a.flac", "/tracks/b.flac"]);
    expect(controls.getCurrentBufferedAheadSeconds()).toBe(7.5);

    controls.setPlaybackRate(1.5);
    controls.setCrossfadeDuration(1_250);

    expect(host.setLastPlaybackRate).toHaveBeenCalledWith(1.5);
    expect(player.setPlaybackRate).toHaveBeenCalledWith(1.5);
    expect(player.setCrossfade).toHaveBeenCalledWith(1_250);
  });

  it.each([
    ["play", false],
    ["play", true],
    ["fadeInAndPlay", false],
    ["fadeInAndPlay", true],
  ] as const)(
    "invokes player.play synchronously for healthy output via %s (tauri=%s)",
    async (command, isTauriDesktopRuntime) => {
      const recovery = createDeferred();
      const { audioRecovery, controls, player } = createControls({
        audioContextState: "running",
        isTauriDesktopRuntime,
        prepare: () => recovery.promise,
        recoveryRequired: false,
      });

      const playback =
        command === "play" ? controls.play() : controls.fadeInAndPlay(0);
      const synchronousPlayCalls = player.play.mock.calls.length;

      recovery.resolve();
      await playback;

      expect(audioRecovery.prepare).toHaveBeenCalledTimes(1);
      expect(synchronousPlayCalls).toBe(1);
      expect(player.play).toHaveBeenCalledTimes(1);
    },
  );

  it.each([
    ["play", "suspended AudioContext", "suspended", false],
    ["fadeInAndPlay", "suspended AudioContext", "suspended", false],
    ["play", "closed AudioContext", "closed", false],
    ["fadeInAndPlay", "closed AudioContext", "closed", false],
    ["play", "stale Tauri output", "running", true],
    ["fadeInAndPlay", "stale Tauri output", "running", true],
    ["play", "recovery already in flight", "running", false],
    ["fadeInAndPlay", "recovery already in flight", "running", false],
  ] as const)(
    "%s waits for %s before invoking player.play",
    async (command, _scenario, audioContextState, isTauriDesktopRuntime) => {
      const recovery = createDeferred();
      const { audioRecovery, controls, player } = createControls({
        audioContextState,
        isTauriDesktopRuntime,
        prepare: () => recovery.promise,
        recoveryRequired: true,
      });

      const playback =
        command === "play" ? controls.play() : controls.fadeInAndPlay(0);

      expect(audioRecovery.prepare).toHaveBeenCalledTimes(1);
      expect(player.play).not.toHaveBeenCalled();

      recovery.resolve();
      await playback;

      expect(player.play).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["play", "fadeInAndPlay", "next", "gotoTrack"] as const)(
    "does not apply a pending %s after pause invalidates it",
    async (command) => {
      const recovery = createDeferred();
      const { controls, host, player } = createControls({
        prepare: () => recovery.promise,
        recoveryRequired: true,
      });
      const operation =
        command === "play"
          ? controls.play()
          : command === "fadeInAndPlay"
            ? controls.fadeInAndPlay(0)
            : command === "next"
              ? controls.next()
              : controls.gotoTrack(0, true);

      controls.pause();
      recovery.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(player.play).not.toHaveBeenCalled();
      expect(player.next).not.toHaveBeenCalled();
      expect(player.gotoTrack).not.toHaveBeenCalled();
      expect(host.setPlaybackActive).toHaveBeenLastCalledWith(false);
      await expect(operation).resolves.toBe("cancelled");
    },
  );

  it.each(["play", "next", "gotoTrack"] as const)(
    "does not apply a pending %s after stop invalidates it",
    async (command) => {
      const recovery = createDeferred();
      const { controls, player } = createControls({
        prepare: () => recovery.promise,
        recoveryRequired: true,
      });
      const operation =
        command === "play"
          ? controls.play()
          : command === "next"
            ? controls.next()
            : controls.gotoTrack(0, true);

      controls.stop();
      recovery.resolve();
      await Promise.resolve();
      await Promise.resolve();

      expect(player.play).not.toHaveBeenCalled();
      expect(player.next).not.toHaveBeenCalled();
      expect(player.gotoTrack).not.toHaveBeenCalled();
      await expect(operation).resolves.toBe("cancelled");
    },
  );
});

// The resume fade runs on the audio clock: a ramp scheduled on the player's
// master gain when playback starts, so a busy main thread or a slow recovery
// step can never leave a started track playing at gain 0 while the playhead
// advances (the "stalls 2 s and starts at 0:41" report).
function withAudioClock(player: ReturnType<typeof createPlayer>) {
  const log: string[] = [];
  const gain = {
    value: 1,
    cancelScheduledValues: vi.fn((t: number) => log.push(`cancel@${t}`)),
    setValueAtTime: vi.fn((v: number, t: number) => log.push(`set ${v}@${t}`)),
    linearRampToValueAtTime: vi.fn((v: number, t: number) =>
      log.push(`ramp ${v}@${t}`),
    ),
  };
  Object.assign(player, {
    context: { currentTime: 10, state: "running" },
    masterOut: { gain },
  });
  player.play.mockImplementation(() => log.push("play"));
  player.pause.mockImplementation(() => log.push("pause"));
  return { gain, log };
}

describe("gapless player fades on the audio clock", () => {
  it("schedules the fade-in ramp before the track starts, without animation frames", async () => {
    vi.useFakeTimers();
    const raf = vi
      .spyOn(globalThis, "requestAnimationFrame")
      .mockImplementation(() => 0);
    try {
      const { controls, player } = createControls();
      const { log } = withAudioClock(player);

      const result = controls.fadeInAndPlay(220);
      await vi.advanceTimersByTimeAsync(250);

      expect(log).toEqual([
        "cancel@10",
        "set 1@10",
        "cancel@10",
        "set 0@10",
        "ramp 1@10.22",
        "play",
      ]);
      await expect(result).resolves.toBe("applied");
    } finally {
      raf.mockRestore();
      vi.useRealTimers();
    }
  });

  it("starts the ramp with playback even while audio recovery is still settling", async () => {
    const recovery = createDeferred();
    const { controls, player } = createControls({
      prepare: () => recovery.promise,
    });
    const { gain } = withAudioClock(player);

    const result = controls.fadeInAndPlay(220);
    await Promise.resolve();

    expect(player.play).toHaveBeenCalledTimes(1);
    expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(1, 10.22);
    recovery.resolve();
    await result;
  });

  it("fades out on the audio clock, pauses, then restores the master gain", async () => {
    vi.useFakeTimers();
    try {
      const { controls, player } = createControls();
      const { log } = withAudioClock(player);

      const result = controls.fadeOutAndPause(220);
      expect(player.pause).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(220);

      expect(log).toEqual([
        "cancel@10",
        "set 1@10",
        "cancel@10",
        "set 1@10",
        "ramp 0@10.22",
        "pause",
        "cancel@10",
        "set 1@10",
      ]);
      await expect(result).resolves.toBe("applied");
    } finally {
      vi.useRealTimers();
    }
  });

  it("gives a superseded fade-out its gain back instead of pausing", async () => {
    vi.useFakeTimers();
    try {
      const { controls, player } = createControls();
      const { gain } = withAudioClock(player);

      const fadeOut = controls.fadeOutAndPause(220);
      await vi.advanceTimersByTimeAsync(100);
      await controls.play();
      await vi.advanceTimersByTimeAsync(200);

      expect(player.pause).not.toHaveBeenCalled();
      expect(gain.setValueAtTime).toHaveBeenLastCalledWith(1, 10);
      await expect(fadeOut).resolves.toBe("cancelled");
    } finally {
      vi.useRealTimers();
    }
  });
});
