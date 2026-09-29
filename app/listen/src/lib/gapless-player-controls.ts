import { Gapless5 } from "@/lib/gapless5/gapless5";
import type { AudioRecoveryController } from "./gapless-player-audio-recovery";
import {
  animateVolume,
  applyVolume,
  getAppliedVolume,
  getLastVolume,
  setLastVolume,
  stopFade,
} from "./gapless-player-volume";

const DEFAULT_FADE_MS = 220;
const RESUMED_AUDIO_CONTEXT_RAMP_MS = 24;
const PLAYBACK_RECOVERY_OPTIONS = {
  rebuildIfTauriOutputMayBeStale: true,
} as const;

export type PlaybackIntentResult = "applied" | "cancelled";

export interface GaplessPlayerControlHost {
  audioRecovery: AudioRecoveryController;
  getAudioContext: () => AudioContext | null;
  getCrossfadeDurationMs: () => number;
  getPlayer: () => Gapless5 | null;
  isTauriDesktopRuntime: () => boolean;
  setLastPlaybackRate: (rate: number) => void;
  setPlaybackActive: (active: boolean) => void;
}

export interface GaplessPlayerControls {
  play: () => Promise<PlaybackIntentResult>;
  pause: () => void;
  stop: () => void;
  next: () => Promise<PlaybackIntentResult>;
  prev: () => void;
  gotoTrack: (
    indexOrUrl: number | string,
    forcePlay?: boolean,
  ) => Promise<PlaybackIntentResult>;
  seekTo: (positionMs: number) => void;
  setVolume: (volume: number) => void;
  setPlaybackRate: (rate: number) => void;
  getPosition: () => number;
  getCurrentBufferedAheadSeconds: () => number;
  getCurrentTrackDuration: () => number;
  getCurrentTrackUrl: () => string;
  getTrackIndex: () => number;
  getTracks: () => string[];
  setShuffle: (enabled: boolean) => void;
  updateCrossfade: () => void;
  setCrossfadeDuration: (durationMs: number) => void;
  fadeOutAndPause: (durationMs?: number) => Promise<PlaybackIntentResult>;
  fadeInAndPlay: (durationMs?: number) => Promise<PlaybackIntentResult>;
  cancelPendingRecovery: () => void;
  restoreVolume: () => void;
  setLoop: (enabled: boolean) => void;
  setSingleMode: (enabled: boolean) => void;
}

export function createGaplessPlayerControls(
  host: GaplessPlayerControlHost,
): GaplessPlayerControls {
  let intentGeneration = 0;
  let pendingRecoveryIntent: number | null = null;

  const beginIntent = (): number => {
    intentGeneration += 1;
    pendingRecoveryIntent = null;
    stopFade();
    return intentGeneration;
  };

  const isCurrentIntent = (intent: number): boolean =>
    intent === intentGeneration;

  const startPlaybackWithRecovery = async (
    reason: string,
    startPlayback: () => void,
    intent: number,
  ): Promise<PlaybackIntentResult> => {
    const shouldWaitForRecovery = host.audioRecovery.needsRecovery(
      PLAYBACK_RECOVERY_OPTIONS,
    );
    const recovery = host.audioRecovery.prepare(
      reason,
      PLAYBACK_RECOVERY_OPTIONS,
    );
    if (shouldWaitForRecovery) pendingRecoveryIntent = intent;
    if (!shouldWaitForRecovery && isCurrentIntent(intent)) startPlayback();
    try {
      await recovery;
    } catch (error) {
      if (!isCurrentIntent(intent)) return "cancelled";
      throw error;
    } finally {
      if (pendingRecoveryIntent === intent) pendingRecoveryIntent = null;
    }
    if (!isCurrentIntent(intent)) return "cancelled";
    if (shouldWaitForRecovery) startPlayback();
    return "applied";
  };

  const runTransportWithRecovery = async (
    reason: string,
    applyTransport: () => boolean,
  ): Promise<PlaybackIntentResult> => {
    const intent = beginIntent();
    const shouldWaitForRecovery = host.audioRecovery.needsRecovery(
      PLAYBACK_RECOVERY_OPTIONS,
    );
    const recovery = host.audioRecovery.prepare(
      reason,
      PLAYBACK_RECOVERY_OPTIONS,
    );
    if (shouldWaitForRecovery) pendingRecoveryIntent = intent;
    let appliedSynchronously = false;
    if (!shouldWaitForRecovery && isCurrentIntent(intent)) {
      appliedSynchronously = applyTransport();
    }
    try {
      await recovery;
    } catch (error) {
      if (!isCurrentIntent(intent)) return "cancelled";
      throw error;
    } finally {
      if (pendingRecoveryIntent === intent) pendingRecoveryIntent = null;
    }
    if (!isCurrentIntent(intent)) return "cancelled";
    if (shouldWaitForRecovery) {
      if (!applyTransport()) return "cancelled";
    } else if (!appliedSynchronously) {
      return "cancelled";
    }
    return "applied";
  };

  const play = async (): Promise<PlaybackIntentResult> => {
    const intent = beginIntent();
    const shouldRampAfterResume =
      !host.isTauriDesktopRuntime() &&
      host.getAudioContext()?.state === "suspended";
    const startPlayback = (): void => {
      host.setPlaybackActive(true);
      const player = host.getPlayer();
      if (shouldRampAfterResume && player) {
        applyVolume(0);
        player.play();
        animateVolume(0, getLastVolume(), RESUMED_AUDIO_CONTEXT_RAMP_MS);
        return;
      }
      player?.play();
    };
    return startPlaybackWithRecovery("play", startPlayback, intent);
  };

  const pause = (): void => {
    beginIntent();
    host.setPlaybackActive(false);
    host.getPlayer()?.pause();
  };

  const stop = (): void => {
    beginIntent();
    host.setPlaybackActive(false);
    host.getPlayer()?.stop();
  };

  const next = (): Promise<PlaybackIntentResult> =>
    runTransportWithRecovery("next", () => {
      const player = host.getPlayer();
      if (!player) return false;
      host.setPlaybackActive(true);
      player.next(undefined, true, true);
      return true;
    });

  const prev = (): void => {
    beginIntent();
    host.getPlayer()?.prev(undefined, false);
  };

  const gotoTrack = async (
    indexOrUrl: number | string,
    forcePlay = false,
  ): Promise<PlaybackIntentResult> => {
    if (!forcePlay) {
      beginIntent();
      const player = host.getPlayer();
      if (!player) return "cancelled";
      player.gotoTrack(indexOrUrl, forcePlay);
      return "applied";
    }
    return runTransportWithRecovery("gotoTrack", () => {
      const player = host.getPlayer();
      if (!player) return false;
      host.setPlaybackActive(true);
      player.gotoTrack(indexOrUrl, forcePlay);
      return true;
    });
  };

  const seekTo = (positionMs: number): void => {
    host.getPlayer()?.setPosition(positionMs);
  };

  const setVolume = (volume: number): void => {
    setLastVolume(volume);
    applyVolume(volume);
  };

  const setPlaybackRate = (rate: number): void => {
    const safeRate = Math.max(0.25, Math.min(rate, 4));
    host.setLastPlaybackRate(safeRate);
    host.getPlayer()?.setPlaybackRate(safeRate);
  };

  const getPosition = (): number => host.getPlayer()?.getPosition() ?? 0;

  const getCurrentBufferedAheadSeconds = (): number =>
    host.getPlayer()?.getCurrentBufferedAheadSeconds() ?? 0;

  const getCurrentTrackDuration = (): number =>
    host.getPlayer()?.currentLength() ?? 0;

  const getCurrentTrackUrl = (): string => host.getPlayer()?.getTrack() ?? "";

  const getTrackIndex = (): number => host.getPlayer()?.getIndex() ?? -1;

  const getTracks = (): string[] => host.getPlayer()?.getTracks() ?? [];

  /**
   * @deprecated Shuffle is owned by the React layer (PlayerContext reorders
   * the queue and feeds the engine sequentially). Kept for API completeness;
   * do not call — using Gapless-5's shuffle alongside a pre-shuffled queue
   * causes a double-shuffle.
   */
  const setShuffle = (enabled: boolean): void => {
    const player = host.getPlayer();
    if (!player) return;
    if (enabled && !player.isShuffled()) {
      player.shuffle(true);
    } else if (!enabled && player.isShuffled()) {
      player.toggleShuffle();
    }
  };

  const updateCrossfade = (): void => {
    host.getPlayer()?.setCrossfade(host.getCrossfadeDurationMs());
  };

  const setCrossfadeDuration = (durationMs: number): void => {
    host.getPlayer()?.setCrossfade(Math.max(0, durationMs));
  };

  const fadeOutAndPause = (
    durationMs = DEFAULT_FADE_MS,
  ): Promise<PlaybackIntentResult> => {
    const intent = beginIntent();
    if (!host.getPlayer()) return Promise.resolve("applied");
    const startVolume = getAppliedVolume();
    return new Promise((resolve) => {
      animateVolume(startVolume, 0, durationMs, () => {
        if (!isCurrentIntent(intent)) {
          resolve("cancelled");
          return;
        }
        host.getPlayer()?.pause();
        host.setPlaybackActive(false);
        applyVolume(getLastVolume());
        resolve("applied");
      });
    });
  };

  const fadeInAndPlay = async (
    durationMs = DEFAULT_FADE_MS,
  ): Promise<PlaybackIntentResult> => {
    const intent = beginIntent();
    if (!host.getPlayer()) return "applied";
    const startPlayback = (): void => {
      applyVolume(0);
      host.setPlaybackActive(true);
      host.getPlayer()?.play();
    };
    const result = await startPlaybackWithRecovery(
      "fadeInAndPlay",
      startPlayback,
      intent,
    );
    if (result === "cancelled") return result;
    return new Promise((resolve) => {
      animateVolume(0, getLastVolume(), durationMs, () => {
        resolve(isCurrentIntent(intent) ? "applied" : "cancelled");
      });
    });
  };

  const cancelPendingRecovery = (): void => {
    if (pendingRecoveryIntent === null) return;
    intentGeneration += 1;
    pendingRecoveryIntent = null;
  };

  const restoreVolume = (): void => {
    applyVolume(getLastVolume());
  };

  const setLoop = (enabled: boolean): void => {
    const player = host.getPlayer();
    if (!player) return;
    player.loop = enabled;
  };

  const setSingleMode = (enabled: boolean): void => {
    const player = host.getPlayer();
    if (!player) return;
    player.singleMode = enabled;
  };

  return {
    play,
    pause,
    stop,
    next,
    prev,
    gotoTrack,
    seekTo,
    setVolume,
    setPlaybackRate,
    getPosition,
    getCurrentBufferedAheadSeconds,
    getCurrentTrackDuration,
    getCurrentTrackUrl,
    getTrackIndex,
    getTracks,
    setShuffle,
    updateCrossfade,
    setCrossfadeDuration,
    fadeOutAndPause,
    fadeInAndPlay,
    cancelPendingRecovery,
    restoreVolume,
    setLoop,
    setSingleMode,
  };
}
