/**
 * Gapless audio player wrapper around Gapless-5.
 *
 * Provides crossfade, gapless playback, and exposes the AnalyserNode
 * for the visualizer. Replaces the raw HTMLAudioElement approach.
 */

import { Gapless5 } from "@/lib/gapless5/gapless5";
import {
  isMobileAudioRuntime,
  stableMobileAudioPipeline,
} from "@/lib/mobile-audio-mode";
import { recordDevLog, redactUrl } from "@/lib/dev-logs";
import { createAudioRecoveryController } from "./gapless-player-audio-recovery";
import {
  getEqualizerState,
  resetEqualizer,
  setEqualizer as applyEqualizer,
  setEqualizerHost,
} from "./gapless-player-equalizer";
import { getCrossfadeDurationPreference } from "./player-playback-prefs";
import {
  applyVolume,
  getLastVolume,
  setVolumeSink,
  stopFade,
} from "./gapless-player-volume";
import {
  createGaplessPlayerControls,
  type GaplessPlayerControls,
} from "./gapless-player-controls";
import {
  addTrack as addQueueTrack,
  insertTrack as insertQueueTrack,
  loadQueue as loadQueueTracks,
  removeTrack as removeQueueTrack,
  replaceTrack as replaceQueueTrack,
} from "./gapless-player-queue";

type GaplessOutputInternal = Gapless5 & {
  context?: AudioContext;
};

// The package's TS declarations don't expose these enums as named imports,
// but the runtime constants are stable in gapless5.js:
// LogLevel.Warning = 3, CrossfadeShape.EqualPower = 3.
const GAPLESS_LOG_LEVEL_WARNING = 3;
const GAPLESS_CROSSFADE_EQUAL_POWER = 3;
const DESKTOP_DECODE_TRACK_LIMIT = 2;
const MOBILE_HTML5_TRACK_LIMIT = 1;
const ADJACENT_LOAD_BUFFER_SECONDS = 15;

export interface GaplessPlayerCallbacks {
  onTimeUpdate?: (positionMs: number, trackIndex: number) => void;
  onDurationChange?: (durationMs: number) => void;
  onPlayRequest?: (trackPath: string) => void;
  onPlay?: (trackPath: string) => void;
  onPause?: (trackPath: string) => void;
  onTrackFinished?: (trackPath: string) => void;
  onAllFinished?: () => void;
  onPrev?: (from: string, to: string) => void;
  onNext?: (from: string, to: string) => void;
  onLoad?: (
    trackPath: string,
    fullyLoaded: boolean,
    durationMs: number,
  ) => void;
  onError?: (trackPath: string, error: unknown) => void;
  onBuffering?: (trackPath: string) => void;
  onAnalyserReady?: (analyser: AnalyserNode) => void;
  onAnalyserInvalidated?: () => void;
}

export interface PlaybackGestureRequiredError {
  type: "not_allowed";
  name?: string;
  message?: string;
}

let instance: Gapless5 | null = null;
let currentCallbacks: GaplessPlayerCallbacks = {};
let currentAnalyser: AnalyserNode | null = null;
// True once the current track's audio is fully decoded into the
// WebAudio buffer (RAM). In that state, network loss cannot stop
// playback — the consumer (soft-interruption logic) can use this to
// decide whether it's worth pausing on an offline event.
let currentTrackFullyBuffered = false;
let lastKnownPlaybackPosition: {
  trackPath: string;
  positionMs: number;
} | null = null;
export function getPlaybackLoadLimit(preferHtml5Audio: boolean): number {
  return preferHtml5Audio
    ? MOBILE_HTML5_TRACK_LIMIT
    : DESKTOP_DECODE_TRACK_LIMIT;
}
let lastPlaybackRate = 1.0;
let tauriAudioOutputMayBeStale = false;
let tauriPlaybackWasActive = false;

function getCrossfadeMs(): number {
  const seconds = getCrossfadeDurationPreference();
  return seconds * 1000;
}

export function getPlayer(): Gapless5 | null {
  return instance;
}

export function getAnalyserNode(): AnalyserNode | null {
  return currentAnalyser;
}

/**
 * True when the current track's audio has been fully decoded into the
 * WebAudio buffer — i.e. the playback does not depend on the network
 * any more. Useful for deciding whether an offline event should pause
 * the player at all (if RAM has the whole thing, it shouldn't).
 */
export function isCurrentTrackFullyBuffered(): boolean {
  return currentTrackFullyBuffered;
}

export function getCurrentBufferedAheadSeconds(): number {
  return playerControls.getCurrentBufferedAheadSeconds();
}

export function isPlaybackGestureRequiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<PlaybackGestureRequiredError>;
  return (
    candidate.type === "not_allowed" || candidate.name === "NotAllowedError"
  );
}

function setKnownPlaybackPosition(trackPath: string, positionMs: number): void {
  if (!trackPath || !Number.isFinite(positionMs)) return;
  lastKnownPlaybackPosition = {
    trackPath,
    positionMs: Math.max(0, positionMs),
  };
}

function rememberPlaybackPosition(trackPath: string, positionMs: number): void {
  if (!trackPath || !Number.isFinite(positionMs)) return;
  if (
    positionMs <= 0 &&
    lastKnownPlaybackPosition?.trackPath === trackPath &&
    lastKnownPlaybackPosition.positionMs > 0
  ) {
    // WebKitGTK can report zero after minimizing even though the paused
    // player still owns the position. Explicit seek/restart paths use
    // setKnownPlaybackPosition and are allowed to reset it to zero.
    return;
  }
  setKnownPlaybackPosition(trackPath, positionMs);
}

function restoreBufferedPlaybackPosition(): number | null {
  const player = instance;
  if (!player || tauriPlaybackWasActive || !currentTrackFullyBuffered) {
    return null;
  }
  const trackPath = player.getTrack();
  const remembered = lastKnownPlaybackPosition;
  if (
    !trackPath ||
    remembered?.trackPath !== trackPath ||
    remembered.positionMs <= 0
  ) {
    return null;
  }

  const reportedPosition = player.getPosition();
  if (reportedPosition <= 0) {
    player.setPosition(remembered.positionMs);
    setKnownPlaybackPosition(trackPath, remembered.positionMs);
    return remembered.positionMs;
  }
  return reportedPosition;
}

function setAnalyser(analyser: AnalyserNode | null) {
  if (!analyser) {
    invalidateAnalyser();
    return;
  }
  if (analyser === currentAnalyser) return;
  currentAnalyser = analyser;
  currentCallbacks.onAnalyserReady?.(analyser);
}

function invalidateAnalyser() {
  if (!currentAnalyser) return;
  currentAnalyser = null;
  currentCallbacks.onAnalyserInvalidated?.();
}

export function initPlayer(callbacks: GaplessPlayerCallbacks = {}): Gapless5 {
  if (instance) {
    currentCallbacks = callbacks;
    return instance;
  }

  audioRecovery.install();
  currentCallbacks = callbacks;
  const preferHtml5Audio = stableMobileAudioPipeline;
  const probe =
    typeof document !== "undefined" ? document.createElement("audio") : null;
  recordDevLog(
    "audio",
    "runtime capabilities",
    {
      useHTML5Audio: true,
      useWebAudio: !preferHtml5Audio,
      flac: probe?.canPlayType("audio/flac") || "",
      xFlac: probe?.canPlayType("audio/x-flac") || "",
      mp4Aac: probe?.canPlayType('audio/mp4; codecs="mp4a.40.2"') || "",
      aac: probe?.canPlayType("audio/aac") || "",
      mp3: probe?.canPlayType("audio/mpeg") || "",
      wav: probe?.canPlayType("audio/wav") || "",
    },
    "info",
  );

  instance = new Gapless5({
    useHTML5Audio: true,
    // Android WebView and iOS WebKit are both more reliable for mobile
    // background/lock-screen playback when the live source is <audio>.
    // Desktop keeps WebAudio for EQ, visualizers and true RAM-backed gapless.
    useWebAudio: !preferHtml5Audio,
    analyserPrecision: preferHtml5Audio ? null : 2048,
    crossfade: getCrossfadeMs(),
    crossfadeShape: GAPLESS_CROSSFADE_EQUAL_POWER,
    persistentHTML5Audio: isMobileAudioRuntime,
    volume: getLastVolume(),
    logLevel: GAPLESS_LOG_LEVEL_WARNING,
    // Keep the next mobile <audio> source ready before the active element
    // reaches ended, but only after the current stream has a safe buffer.
    // Starting both FLAC requests together can starve Android's active decoder.
    loadLimit: isMobileAudioRuntime
      ? MOBILE_HTML5_TRACK_LIMIT
      : getPlaybackLoadLimit(preferHtml5Audio),
    deferAdjacentLoadsUntilBufferedSeconds: ADJACENT_LOAD_BUFFER_SECONDS,
    // Desktop may start through HTML5 while WebAudio is still decoding. Once
    // the active buffer is ready, promote it so the analyser-backed
    // visualizers attach to the first track as well. Mobile keeps its stable
    // HTML5-only path above.
    switchToWebAudioDuringPlayback: !preferHtml5Audio,
  });
  setVolumeSink((volume) => instance?.setVolume(volume));
  setEqualizerHost(instance as GaplessOutputInternal);

  instance.ontimeupdate = (posMs, trackIndex) => {
    const trackPath = instance?.getTrack();
    if (trackPath) rememberPlaybackPosition(trackPath, posMs);
    currentCallbacks.onTimeUpdate?.(posMs, trackIndex);
  };

  instance.onplayrequest = (path) => {
    currentCallbacks.onPlayRequest?.(path);
  };

  instance.onplay = (path, analyser) => {
    tauriPlaybackWasActive = true;
    rememberPlaybackPosition(path, instance?.getPosition() ?? 0);
    // analyser is only emitted when WebAudio is the live source.
    // Presence here means the track's buffer is already decoded in RAM
    // (the "switched" case where onplay replaces onswitchtowebaudio).
    currentTrackFullyBuffered = analyser != null;
    setAnalyser(analyser);
    currentCallbacks.onPlay?.(path);
  };

  instance.onpause = (path) => {
    const reportedPosition = instance?.getPosition() ?? 0;
    rememberPlaybackPosition(path, reportedPosition);
    recordDevLog(
      "audio",
      "paused position snapshot",
      {
        track: redactUrl(path),
        reportedPosition,
        rememberedPosition:
          lastKnownPlaybackPosition?.trackPath === path
            ? lastKnownPlaybackPosition.positionMs
            : null,
      },
      "info",
    );
    currentCallbacks.onPause?.(path);
  };

  instance.onprev = (from, to) => {
    currentTrackFullyBuffered = false;
    invalidateAnalyser();
    setKnownPlaybackPosition(to, 0);
    currentCallbacks.onPrev?.(from, to);
  };

  instance.onfinishedtrack = (path) => {
    currentCallbacks.onTrackFinished?.(path);
  };

  instance.onfinishedall = () => {
    tauriPlaybackWasActive = false;
    const trackPath = instance?.getTrack();
    if (trackPath) setKnownPlaybackPosition(trackPath, 0);
    currentCallbacks.onAllFinished?.();
  };

  instance.onnext = (from, to) => {
    currentTrackFullyBuffered = false;
    invalidateAnalyser();
    setKnownPlaybackPosition(to, 0);
    currentCallbacks.onNext?.(from, to);
  };

  instance.onerror = (path, err) => {
    recordDevLog(
      "gapless",
      "error",
      { path: redactUrl(path), error: String(err) },
      "error",
    );
    currentCallbacks.onError?.(path, err);
  };

  instance.onloadstart = (path) => {
    if (path === instance?.getTrack()) {
      currentTrackFullyBuffered = false;
    }
    recordDevLog("gapless", "load start", redactUrl(path), "debug");
    currentCallbacks.onBuffering?.(path);
  };

  instance.onload = (path, fullyLoaded) => {
    // Gapless5 reports `fullyLoaded` only after the WebAudio fetch has been
    // decoded into an AudioBuffer. That can finish after the user pauses,
    // before the HTML5 → WebAudio promotion fires; keep the RAM-backed state
    // accurate so a Tauri wake does not rebuild the player and fetch again.
    const currentTrackBufferReady =
      fullyLoaded && path === instance?.getTrack();
    if (currentTrackBufferReady) {
      currentTrackFullyBuffered = true;
    }
    const durationMs = getCurrentTrackDuration();
    recordDevLog(
      "gapless",
      fullyLoaded ? "loaded webaudio" : "loaded html5",
      {
        path: redactUrl(path),
        durationMs,
        currentTrackBufferReady,
      },
      "info",
    );
    currentCallbacks.onLoad?.(path, fullyLoaded, durationMs);
    currentCallbacks.onDurationChange?.(durationMs);
  };

  // Runtime (gapless5.js:309) calls this as (trackPath, analyser).
  instance.onswitchtowebaudio = (_path, analyser) => {
    // HTML5 → WebAudio switch. From this moment the track plays from
    // RAM; network failures are survivable.
    currentTrackFullyBuffered = true;
    recordDevLog("gapless", "switched to webaudio", redactUrl(_path), "info");
    setAnalyser(analyser);
  };

  instance.onunload = (path) => {
    if (path === instance?.getTrack()) {
      currentTrackFullyBuffered = false;
    }
  };

  return instance;
}

export function destroyPlayer(): void {
  playerControls.cancelPendingRecovery();
  stopFade();
  resetEqualizer();
  setEqualizerHost(null);
  lastPlaybackRate = 1.0;
  if (instance) {
    // Gapless-5 shares a single AudioContext across every instance via
    // `window.gapless5AudioContext` — if we don't clear it here, the next
    // initPlayer() in this same page session (e.g. logout → login without
    // a reload) reuses a context that belonged to the instance we just
    // tore down instead of getting a fresh one.
    const previousContext = getAudioContext();
    try {
      instance.stop();
      instance.removeAllTracks();
    } catch {
      /* ignore */
    }
    instance = null;
    currentAnalyser = null;
    currentTrackFullyBuffered = false;
    audioRecovery.clearSharedGaplessAudioContext(previousContext);
  }
  setVolumeSink(null);
  tauriPlaybackWasActive = false;
  tauriAudioOutputMayBeStale = false;
  lastKnownPlaybackPosition = null;
}

// ── Convenience methods ──────────────────────────────────────────

export function loadQueue(
  urls: string[],
  startIndex = 0,
  options: { restartIfSameIndex?: boolean } = {},
): void {
  if (!instance) return;
  const previousTracks = instance.getTracks();
  const previousTrackPath = instance.getTrack();
  const queueChanged =
    previousTracks.length !== urls.length ||
    urls.some((url, index) => url !== previousTracks[index]);
  if (queueChanged || options.restartIfSameIndex) {
    playerControls.cancelPendingRecovery();
  }
  loadQueueTracks(instance, urls, startIndex, options, () => {
    currentTrackFullyBuffered = false;
  });
  const trackPath = instance.getTrack();
  if (!trackPath) return;
  if (
    options.restartIfSameIndex ||
    queueChanged ||
    previousTrackPath !== trackPath
  ) {
    setKnownPlaybackPosition(trackPath, 0);
  } else {
    rememberPlaybackPosition(trackPath, instance.getPosition());
  }
}

export function addTrack(url: string): void {
  addQueueTrack(instance, url);
}

export function insertTrack(index: number, url: string): void {
  insertQueueTrack(instance, index, url);
}

export function removeTrack(indexOrUrl: number | string): void {
  removeQueueTrack(instance, indexOrUrl);
}

export function replaceTrack(index: number, url: string): void {
  replaceQueueTrack(instance, index, url);
}

function getAudioContext(): AudioContext | null {
  return (instance as GaplessOutputInternal | null)?.context ?? null;
}

function isTauriDesktopRuntime(): boolean {
  return (
    typeof document !== "undefined" &&
    document.documentElement.dataset.listenRuntime === "tauri"
  );
}

const audioRecovery = createAudioRecoveryController({
  getAudioContext,
  isTauriDesktopRuntime,
  isPlaybackActive: () => tauriPlaybackWasActive,
  isOutputStale: () => tauriAudioOutputMayBeStale,
  canReuseCurrentTrackBuffer: () => currentTrackFullyBuffered,
  restoreBufferedPlaybackPosition,
  markOutputStale: () => {
    tauriAudioOutputMayBeStale = true;
  },
  clearOutputStale: () => {
    tauriAudioOutputMayBeStale = false;
  },
  rebuildPlayer: (reason) => rebuildPlayerAfterAudioContextLoss(reason),
});

const playerControls: GaplessPlayerControls = createGaplessPlayerControls({
  audioRecovery,
  getAudioContext,
  getCrossfadeDurationMs: getCrossfadeMs,
  getPlayer: () => instance,
  isTauriDesktopRuntime,
  setLastPlaybackRate: (rate) => {
    lastPlaybackRate = rate;
  },
  setPlaybackActive: (active) => {
    tauriPlaybackWasActive = active;
  },
});

function rebuildPlayerAfterAudioContextLoss(reason: string): void {
  if (!instance) return;
  const previous = instance;
  const previousContext = getAudioContext();
  const tracks = previous.getTracks();
  const index = Math.max(0, Math.min(previous.getIndex(), tracks.length - 1));
  const previousTrackPath = previous.getTrack();
  const reportedPosition = previous.getPosition();
  const rememberedTrackMatches =
    lastKnownPlaybackPosition?.trackPath === previousTrackPath;
  const position = rememberedTrackMatches
    ? lastKnownPlaybackPosition?.positionMs ?? reportedPosition
    : reportedPosition;
  const loop = previous.loop;
  const singleMode = previous.singleMode;
  const crossfade = previous.crossfade;
  const preservedEq = getEqualizerState();

  recordDevLog(
    "audio",
    "rebuilding player after audio context loss",
    {
      reason,
      tracks: tracks.length,
      index,
      track: redactUrl(previousTrackPath),
      position,
      reportedPosition,
      rememberedPosition: lastKnownPlaybackPosition?.positionMs ?? null,
      rememberedTrackMatches,
    },
    "warn",
  );

  stopFade();
  resetEqualizer();
  setEqualizerHost(null);
  try {
    previous.stop();
    previous.removeAllTracks();
  } catch {
    /* ignore */
  }

  instance = null;
  currentAnalyser = null;
  currentTrackFullyBuffered = false;
  audioRecovery.clearSharedGaplessAudioContext(previousContext);

  const nextPlayer = initPlayer(currentCallbacks);
  if (tracks.length > 0) {
    loadQueue(tracks, index);
    if (Number.isFinite(position) && position > 0) {
      seekTo(position);
    }
    recordDevLog(
      "audio",
      "restored playback position",
      {
        track: redactUrl(nextPlayer.getTrack()),
        requestedPosition: position,
        appliedPosition: nextPlayer.getPosition(),
      },
      "info",
    );
  }
  nextPlayer.loop = loop;
  nextPlayer.singleMode = singleMode;
  nextPlayer.setCrossfade(crossfade);
  nextPlayer.setPlaybackRate(lastPlaybackRate);
  applyVolume(getLastVolume());
  applyEqualizer(preservedEq.enabled, preservedEq.gains);
}

export const play = playerControls.play;
export const pause = (): void => {
  const trackPath = instance?.getTrack();
  if (trackPath) {
    rememberPlaybackPosition(trackPath, instance?.getPosition() ?? 0);
  }
  playerControls.pause();
};
export const stop = (): void => {
  const trackPath = instance?.getTrack();
  playerControls.stop();
  if (trackPath) setKnownPlaybackPosition(trackPath, 0);
};
export const next = playerControls.next;
export const prev = playerControls.prev;
export const gotoTrack = async (
  indexOrUrl: number | string,
  forcePlay = false,
): Promise<void> => {
  const previousTrackPath = instance?.getTrack();
  const result = await playerControls.gotoTrack(indexOrUrl, forcePlay);
  if (result === "cancelled") return;
  const trackPath = instance?.getTrack();
  if (trackPath && (trackPath !== previousTrackPath || forcePlay)) {
    setKnownPlaybackPosition(trackPath, 0);
  }
};
export const seekTo = (positionMs: number): void => {
  playerControls.seekTo(positionMs);
  const trackPath = instance?.getTrack();
  if (trackPath) setKnownPlaybackPosition(trackPath, positionMs);
};
export const setVolume = playerControls.setVolume;
export const setPlaybackRate = playerControls.setPlaybackRate;
export const getPosition = playerControls.getPosition;
export const getCurrentTrackDuration = playerControls.getCurrentTrackDuration;
export const getCurrentTrackUrl = playerControls.getCurrentTrackUrl;
export const getTrackIndex = playerControls.getTrackIndex;
export const getTracks = playerControls.getTracks;
export const setShuffle = playerControls.setShuffle;
export const updateCrossfade = playerControls.updateCrossfade;
export const setCrossfadeDuration = playerControls.setCrossfadeDuration;
export const fadeOutAndPause = playerControls.fadeOutAndPause;
export const fadeInAndPlay = playerControls.fadeInAndPlay;
export const restoreVolume = playerControls.restoreVolume;
export const setLoop = playerControls.setLoop;
export const setSingleMode = playerControls.setSingleMode;

export { isEqualizerActive, setEqualizer } from "./gapless-player-equalizer";
