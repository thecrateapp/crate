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
    clearSharedGaplessAudioContext: vi.fn(),
    install: vi.fn(),
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
});
