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
  animateVolume,
  applyVolume,
  getAppliedVolume,
  getLastVolume,
  setLastVolume,
  setVolumeSink,
  stopFade,
} from "./gapless-player-volume";
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
const RESUMED_AUDIO_CONTEXT_RAMP_MS = 24;

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
export function getPlaybackLoadLimit(preferHtml5Audio: boolean): number {
  return preferHtml5Audio
    ? MOBILE_HTML5_TRACK_LIMIT
    : DESKTOP_DECODE_TRACK_LIMIT;
}
let lastPlaybackRate = 1.0;
let tauriAudioOutputMayBeStale = false;
let tauriPlaybackWasActive = false;

const DEFAULT_FADE_MS = 220;

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
  return instance?.getCurrentBufferedAheadSeconds() ?? 0;
}

export function isPlaybackGestureRequiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as Partial<PlaybackGestureRequiredError>;
  return (
    candidate.type === "not_allowed" || candidate.name === "NotAllowedError"
  );
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
    currentCallbacks.onTimeUpdate?.(posMs, trackIndex);
  };

  instance.onplayrequest = (path) => {
    currentCallbacks.onPlayRequest?.(path);
  };

  instance.onplay = (path, analyser) => {
    tauriPlaybackWasActive = true;
    // analyser is only emitted when WebAudio is the live source.
    // Presence here means the track's buffer is already decoded in RAM
    // (the "switched" case where onplay replaces onswitchtowebaudio).
    currentTrackFullyBuffered = analyser != null;
    setAnalyser(analyser);
    currentCallbacks.onPlay?.(path);
  };

  instance.onpause = (path) => {
    currentCallbacks.onPause?.(path);
  };

  instance.onprev = (from, to) => {
    currentTrackFullyBuffered = false;
    invalidateAnalyser();
    currentCallbacks.onPrev?.(from, to);
  };

  instance.onfinishedtrack = (path) => {
    currentCallbacks.onTrackFinished?.(path);
  };

  instance.onfinishedall = () => {
    tauriPlaybackWasActive = false;
    currentCallbacks.onAllFinished?.();
  };

  instance.onnext = (from, to) => {
    currentTrackFullyBuffered = false;
    invalidateAnalyser();
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
    const durationMs = getCurrentTrackDuration();
    recordDevLog(
      "gapless",
      fullyLoaded ? "loaded webaudio" : "loaded html5",
      {
        path: redactUrl(path),
        durationMs,
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

  return instance;
}

export function destroyPlayer(): void {
  stopFade();
  resetEqualizer();
  setEqualizerHost(null);
  lastPlaybackRate = 1.0;
  if (instance) {
    try {
      instance.stop();
      instance.removeAllTracks();
    } catch {
      /* ignore */
    }
    instance = null;
    currentAnalyser = null;
  }
  setVolumeSink(null);
  tauriPlaybackWasActive = false;
}

// ── Convenience methods ──────────────────────────────────────────

export function loadQueue(
  urls: string[],
  startIndex = 0,
  options: { restartIfSameIndex?: boolean } = {},
): void {
  loadQueueTracks(instance, urls, startIndex, options, () => {
    currentTrackFullyBuffered = false;
  });
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
  markOutputStale: () => {
    tauriAudioOutputMayBeStale = true;
  },
  clearOutputStale: () => {
    tauriAudioOutputMayBeStale = false;
  },
  rebuildPlayer: (reason) => rebuildPlayerAfterAudioContextLoss(reason),
});

function rebuildPlayerAfterAudioContextLoss(reason: string): void {
  if (!instance) return;
  const previous = instance;
  const previousContext = getAudioContext();
  const tracks = previous.getTracks();
  const index = Math.max(0, Math.min(previous.getIndex(), tracks.length - 1));
  const position = previous.getPosition();
  const loop = previous.loop;
  const singleMode = previous.singleMode;
  const crossfade = previous.crossfade;
  const preservedEq = getEqualizerState();

  recordDevLog(
    "audio",
    "rebuilding player after audio context loss",
    { reason, tracks: tracks.length, index, position },
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
  }
  nextPlayer.loop = loop;
  nextPlayer.singleMode = singleMode;
  nextPlayer.setCrossfade(crossfade);
  nextPlayer.setPlaybackRate(lastPlaybackRate);
  applyVolume(getLastVolume());
  applyEqualizer(preservedEq.enabled, preservedEq.gains);
}

export async function play(): Promise<void> {
  stopFade();
  const shouldRampAfterResume =
    !isTauriDesktopRuntime() && getAudioContext()?.state === "suspended";
  await audioRecovery.prepare("play", {
    rebuildIfTauriOutputMayBeStale: true,
  });
  tauriPlaybackWasActive = true;
  if (shouldRampAfterResume && instance) {
    applyVolume(0);
    instance.play();
    animateVolume(0, getLastVolume(), RESUMED_AUDIO_CONTEXT_RAMP_MS);
    return;
  }
  instance?.play();
}

export function pause(): void {
  stopFade();
  tauriPlaybackWasActive = false;
  instance?.pause();
}

export function stop(): void {
  stopFade();
  tauriPlaybackWasActive = false;
  instance?.stop();
}

/**
 * Sequential skip forward. Enables crossfade when transitioning to the
 * next track (auto-advance uses the same internal path).
 */
export function next(): void {
  void audioRecovery
    .prepare("next", {
      rebuildIfTauriOutputMayBeStale: true,
    })
    .then(() => {
      tauriPlaybackWasActive = true;
      instance?.next(undefined, true, true);
    });
}

/**
 * Sequential skip backward. Gapless-5's prev() doesn't support crossfade,
 * so this is always a hard cut.
 */
export function prev(): void {
  instance?.prev(undefined, false);
}

/**
 * Jump to an arbitrary track. Does NOT crossfade — use next()/prev()
 * for sequential skips that should respect the crossfade setting.
 */
export function gotoTrack(
  indexOrUrl: number | string,
  forcePlay = false,
): void {
  if (!forcePlay) {
    instance?.gotoTrack(indexOrUrl, forcePlay);
    return;
  }
  void audioRecovery
    .prepare("gotoTrack", {
      rebuildIfTauriOutputMayBeStale: true,
    })
    .then(() => {
      tauriPlaybackWasActive = true;
      instance?.gotoTrack(indexOrUrl, forcePlay);
    });
}

export function seekTo(positionMs: number): void {
  instance?.setPosition(positionMs);
}

export function setVolume(vol: number): void {
  setLastVolume(vol);
  applyVolume(vol);
}

export function setPlaybackRate(rate: number): void {
  const safeRate = Math.max(0.25, Math.min(rate, 4));
  lastPlaybackRate = safeRate;
  instance?.setPlaybackRate(safeRate);
}

export function getPosition(): number {
  return instance?.getPosition() ?? 0;
}

export function getCurrentTrackDuration(): number {
  return instance?.currentLength() ?? 0;
}

export function getCurrentTrackUrl(): string {
  return instance?.getTrack() ?? "";
}

export function getTrackIndex(): number {
  return instance?.getIndex() ?? -1;
}

export function getTracks(): string[] {
  return instance?.getTracks() ?? [];
}

/**
 * @deprecated Shuffle is owned by the React layer (PlayerContext reorders
 * the queue and feeds the engine sequentially). Kept for API completeness;
 * do not call — using Gapless-5's shuffle alongside a pre-shuffled queue
 * causes a double-shuffle (see loadQueue for the details).
 */
export function setShuffle(enabled: boolean): void {
  if (!instance) return;
  if (enabled && !instance.isShuffled()) {
    instance.shuffle(true);
  } else if (!enabled && instance.isShuffled()) {
    instance.toggleShuffle();
  }
}

export function updateCrossfade(): void {
  instance?.setCrossfade(getCrossfadeMs());
}

export function setCrossfadeDuration(durationMs: number): void {
  instance?.setCrossfade(Math.max(0, durationMs));
}

export function fadeOutAndPause(durationMs = DEFAULT_FADE_MS): Promise<void> {
  if (!instance) return Promise.resolve();
  const startVolume = getAppliedVolume();
  return new Promise((resolve) => {
    animateVolume(startVolume, 0, durationMs, () => {
      instance?.pause();
      tauriPlaybackWasActive = false;
      applyVolume(getLastVolume());
      resolve();
    });
  });
}

export async function fadeInAndPlay(
  durationMs = DEFAULT_FADE_MS,
): Promise<void> {
  if (!instance) return Promise.resolve();
  stopFade();
  await audioRecovery.prepare("fadeInAndPlay", {
    rebuildIfTauriOutputMayBeStale: true,
  });
  applyVolume(0);
  tauriPlaybackWasActive = true;
  instance?.play();
  return new Promise((resolve) => {
    animateVolume(0, getLastVolume(), durationMs, resolve);
  });
}

/**
 * Restore applied volume to the last user-set value. Useful after a
 * cancelled fade leaves the player muted.
 */
export function restoreVolume(): void {
  applyVolume(getLastVolume());
}

export function setLoop(enabled: boolean): void {
  if (!instance) return;
  instance.loop = enabled;
}

export function setSingleMode(enabled: boolean): void {
  if (!instance) return;
  instance.singleMode = enabled;
}

export { isEqualizerActive, setEqualizer } from "./gapless-player-equalizer";
