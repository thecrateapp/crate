import {
  useCallback,
  useMemo,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import { getJamQueueSyncPlan, tracksMatch } from "@/contexts/player-session";
import {
  toFreshEngineTrack,
  toStartupEngineTracks,
} from "@/contexts/player-engine-adapter";
import {
  addTrack as gpAddTrack,
  fadeInAndPlay as gpFadeInAndPlay,
  fadeOutAndPause as gpFadeOutAndPause,
  getPosition as gpGetPosition,
  gotoTrack as gpGotoTrack,
  insertTrack as gpInsertTrack,
  loadQueue as gpLoadQueue,
  next as gpNext,
  pause as gpPause,
  play as gpPlay,
  removeTrack as gpRemoveTrack,
  restoreVolume as gpRestoreVolume,
  seekTo as gpSeekTo,
  setLoop as gpSetLoop,
  setPlaybackRate as gpSetPlaybackRate,
  setSingleMode as gpSetSingleMode,
  setVolume as gpSetVolume,
  stop as gpStop,
} from "@/lib/gapless-player";
import {
  clampIndex,
  shouldRestartTrackBeforePrev,
  shuffleKeepingCurrent,
} from "@/contexts/player-queue-helpers";
import {
  getStreamUrl,
  getTrackCacheKey,
  STORAGE_KEY,
} from "@/contexts/player-utils";
import {
  androidNativeEngine as nativeEngine,
  isAndroidNativePlayerAvailable,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import { isNative } from "@/lib/capacitor-runtime";
import { primeOfflineRuntimeProfile } from "@/lib/offline";
import {
  getCrossfadeDurationPreference,
  type PlaybackDeliveryPolicy,
} from "@/lib/player-playback-prefs";
import { preparePlaybackDelivery } from "@/lib/playback-delivery";
import {
  createQueueRevision,
  type EngineRepeatMode,
} from "@/lib/playback-engine";
import {
  castPause,
  castPlay,
  castSeek,
  castSetVolume,
  castStop,
  isCastSessionActive,
  startCastSession,
} from "@/lib/cast-sender";

const SOFT_PAUSE_FADE_MS = 220;
const PREV_DOUBLE_TAP_WINDOW_MS = 1500;
const JAM_EXPLICIT_SYNC_TOLERANCE_SECONDS = 0.005;
function shouldUseImmediateTransportAction(): boolean {
  return (
    typeof document !== "undefined" && document.visibilityState === "hidden"
  );
}

function toEngineRepeatMode(repeat: RepeatMode): EngineRepeatMode {
  return repeat;
}

function getKnownDuration(track: Track | undefined): number {
  return typeof track?.duration === "number" &&
    Number.isFinite(track.duration) &&
    track.duration > 0
    ? track.duration
    : 0;
}

function nativeCrossfadeMs(): number {
  return Math.max(0, getCrossfadeDurationPreference() * 1000);
}

function isJamPlaybackSource(source: PlaySource | undefined): boolean {
  return source?.type === "queue" && source.name.startsWith("Jam:");
}

type QueueEdit =
  | { type: "remove"; index: number; track: Track }
  | { type: "insert"; index: number; track: Track };

function planQueueEdits(
  currentQueue: Track[],
  nextQueue: Track[],
): QueueEdit[] {
  const workingQueue = [...currentQueue];
  const edits: QueueEdit[] = [];

  for (let index = workingQueue.length - 1; index >= 0; index -= 1) {
    const track = workingQueue[index];
    if (
      track &&
      !nextQueue.some((candidate) => tracksMatch(candidate, track))
    ) {
      edits.push({ type: "remove", index, track });
      workingQueue.splice(index, 1);
    }
  }

  for (let index = 0; index < nextQueue.length; index += 1) {
    const target = nextQueue[index];
    if (!target) continue;
    const current = workingQueue[index];
    if (current && tracksMatch(current, target)) continue;

    const existingIndex = workingQueue.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index && tracksMatch(candidate, target),
    );
    if (existingIndex >= 0) {
      const [moved] = workingQueue.splice(existingIndex, 1);
      if (!moved) continue;
      edits.push({ type: "remove", index: existingIndex, track: moved });
      edits.push({ type: "insert", index, track: target });
      workingQueue.splice(index, 0, target);
      continue;
    }

    edits.push({ type: "insert", index, track: target });
    workingQueue.splice(index, 0, target);
  }

  return edits;
}

function playSourcesMatch(
  left: PlaySource | null | undefined,
  right: PlaySource | null | undefined,
): boolean {
  return left?.type === right?.type && left?.name === right?.name;
}

function silenceGaplessEngine() {
  gpPause();
  gpStop();
  gpLoadQueue([], 0);
}

function stopNativeEngineIfAvailable(context: string) {
  if (!isAndroidNativePlayerAvailable()) return;
  void nativeEngine.stop().catch((error) => {
    console.error(`[native-player] failed to stop ${context}:`, error);
  });
}

function playbackPositionMs(currentTimeSeconds: number): number {
  if (shouldUseAndroidNativePlayer()) {
    return Math.max(0, Math.round(currentTimeSeconds * 1000));
  }
  return gpGetPosition();
}

interface UsePlayerQueueActionsParams {
  queueRef: MutableRefObject<Track[]>;
  jamQueueLockedRef: MutableRefObject<boolean>;
  currentIndexRef: MutableRefObject<number>;
  currentTimeRef: MutableRefObject<number>;
  isPlayingRef: MutableRefObject<boolean>;
  repeatRef: MutableRefObject<RepeatMode>;
  shuffleRef: MutableRefObject<boolean>;
  playSourceRef: MutableRefObject<PlaySource | null>;
  unshuffledQueueRef: MutableRefObject<Track[] | null>;
  bufferingIntentRef: MutableRefObject<boolean>;
  pendingRestoreTimeRef: MutableRefObject<number>;
  resumeAfterReloadRef: MutableRefObject<boolean>;
  lastNonZeroVolumeRef: MutableRefObject<number>;
  prevRestartTrackKeyRef: MutableRefObject<string | null>;
  prevRestartedAtRef: MutableRefObject<number>;
  activatedTrackKeyRef: MutableRefObject<string | null>;
  setPlaySource: Dispatch<SetStateAction<PlaySource | null>>;
  setShuffleState: Dispatch<SetStateAction<boolean>>;
  setRepeatState: Dispatch<SetStateAction<RepeatMode>>;
  setVolumeState: Dispatch<SetStateAction<number>>;
  buildEngineUrls: (tracks: Track[], resolvedUrls?: string[]) => string[];
  registerEngineTrack: (track: Track) => string;
  unregisterEngineTrack: (track: Track) => void;
  resetEngineTrackMap: () => void;
  rememberActiveTrack: (track: Track | undefined) => void;
  startTrackerSession: (track: Track, source: PlaySource | null) => void;
  flushCurrentPlayEvent: (
    reason: "completed" | "skipped" | "interrupted",
    track?: Track,
  ) => void;
  markSeekPosition: (seconds: number) => void;
  cancelSoftInterruption: () => void;
  cancelRestoreAutoplay: () => void;
  resetPlaybackIntelligence: () => void;
  continueInfinitePlayback: () => boolean;
  clearPrevRestartLatch: () => void;
  commitQueue: (queue: Track[]) => void;
  commitCurrentIndex: (index: number) => void;
  commitCurrentTime: (time: number) => void;
  commitDuration: (duration: number) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  ensureJamQueueLocked?: () => void;
  pullFromEngine: (sourceQueue?: Track[]) => {
    resolvedTrack: Track | undefined;
  };
  pushToEngine: (
    queue: Track[],
    requestedIndex: number,
    options?: {
      autoplay?: boolean;
      positionMs?: number;
      preservePlayback?: boolean;
    },
  ) => void;
  advanceCursorTo: (index: number) => void;
  publishConnectState?: (options?: { claimActive?: boolean }) => Promise<void>;
  playbackDeliveryPolicy: PlaybackDeliveryPolicy;
}

export function usePlayerQueueActions({
  queueRef,
  jamQueueLockedRef,
  currentIndexRef,
  currentTimeRef,
  isPlayingRef,
  repeatRef,
  shuffleRef,
  playSourceRef,
  unshuffledQueueRef,
  bufferingIntentRef,
  pendingRestoreTimeRef,
  resumeAfterReloadRef,
  lastNonZeroVolumeRef,
  prevRestartTrackKeyRef,
  prevRestartedAtRef,
  activatedTrackKeyRef,
  setPlaySource,
  setShuffleState,
  setRepeatState,
  setVolumeState,
  buildEngineUrls,
  registerEngineTrack,
  unregisterEngineTrack,
  resetEngineTrackMap,
  rememberActiveTrack,
  startTrackerSession,
  flushCurrentPlayEvent,
  markSeekPosition,
  cancelSoftInterruption,
  cancelRestoreAutoplay,
  resetPlaybackIntelligence,
  continueInfinitePlayback,
  clearPrevRestartLatch,
  commitQueue,
  commitCurrentIndex,
  commitCurrentTime,
  commitDuration,
  commitIsPlaying,
  commitIsBuffering,
  ensureJamQueueLocked,
  pullFromEngine,
  pushToEngine,
  advanceCursorTo,
  publishConnectState,
  playbackDeliveryPolicy,
}: UsePlayerQueueActionsParams) {
  const jamQueueSyncRevisionRef = useRef(0);
  const initialJamQueueMutation = useMemo(() => Promise.resolve(), []);
  const nativeJamQueueMutationRef = useRef(initialJamQueueMutation);

  const startQueuePlayback = useCallback(
    (tracks: Track[], startIndex: number, source?: PlaySource) => {
      if (jamQueueLockedRef.current && !isJamPlaybackSource(source)) return;
      if (!tracks.length) return;
      const normalizedIndex = clampIndex(startIndex, tracks.length);
      const restartingSameQueueAtSameIndex =
        queueRef.current.length === tracks.length &&
        currentIndexRef.current === normalizedIndex &&
        queueRef.current.every(
          (track, index) =>
            getStreamUrl(track) === getStreamUrl(tracks[index]!),
        );

      cancelSoftInterruption();
      pendingRestoreTimeRef.current = 0;
      resumeAfterReloadRef.current = false;
      cancelRestoreAutoplay();
      resetPlaybackIntelligence();
      flushCurrentPlayEvent("interrupted");

      preparePlaybackDelivery(tracks, normalizedIndex, playbackDeliveryPolicy, {
        immediate: true,
      });
      const activeTrack = tracks[normalizedIndex];
      commitCurrentTime(0);
      commitDuration(getKnownDuration(activeTrack));
      bufferingIntentRef.current = !restartingSameQueueAtSameIndex;
      commitIsBuffering(!restartingSameQueueAtSameIndex);
      const nextSource =
        source ||
        (tracks.length > 1
          ? { type: "queue" as const, name: "Queue" }
          : { type: "track" as const, name: tracks[normalizedIndex]!.title });
      setPlaySource(nextSource);

      if (shouldUseAndroidNativePlayer()) {
        silenceGaplessEngine();
        commitQueue(tracks);
        commitCurrentIndex(normalizedIndex);
        if (activeTrack) {
          rememberActiveTrack(activeTrack);
          startTrackerSession(activeTrack, nextSource);
        }
        commitIsPlaying(true);
        void primeOfflineRuntimeProfile().catch((error) => {
          console.warn(
            "[offline] failed to prime profile before native load:",
            error,
          );
        });
        void (async () => {
          const engineTracks = await toStartupEngineTracks(
            tracks,
            normalizedIndex,
            undefined,
            { target: "android-native" },
          );
          return nativeEngine.loadQueue({
            revision: createQueueRevision(),
            tracks: engineTracks,
            currentIndex: normalizedIndex,
            positionMs: 0,
            autoplay: true,
            repeat: toEngineRepeatMode(repeatRef.current),
            crossfadeMs: nativeCrossfadeMs(),
            volume: lastNonZeroVolumeRef.current,
          });
        })().catch((error) => {
          console.error("[native-player] failed to load queue:", error);
          commitIsPlaying(false);
          commitIsBuffering(false);
        });
        void publishConnectState?.({ claimActive: true }).catch(() => {});
        return;
      }

      void (async () => {
        const engineTracks = await toStartupEngineTracks(
          tracks,
          normalizedIndex,
        );
        const engineUrls = engineTracks.map((track) => track.url);

        stopNativeEngineIfAvailable("before web queue load");
        gpLoadQueue(buildEngineUrls(tracks, engineUrls), normalizedIndex, {
          restartIfSameIndex: true,
        });
        gpSetLoop(repeatRef.current === "all");
        gpSetSingleMode(repeatRef.current === "one");

        const { resolvedTrack } = pullFromEngine(tracks);
        if (resolvedTrack) {
          rememberActiveTrack(resolvedTrack);
          startTrackerSession(resolvedTrack, nextSource);
        }

        gpPlay();
        void publishConnectState?.({ claimActive: true }).catch(() => {});
      })().catch((error) => {
        console.error("[gapless] failed to resolve queue playback:", error);
        bufferingIntentRef.current = false;
        commitIsBuffering(false);
        commitIsPlaying(false);
      });
    },
    [
      buildEngineUrls,
      cancelSoftInterruption,
      cancelRestoreAutoplay,
      commitCurrentIndex,
      commitCurrentTime,
      commitIsBuffering,
      commitIsPlaying,
      commitQueue,
      commitDuration,
      bufferingIntentRef,
      currentIndexRef,
      jamQueueLockedRef,
      flushCurrentPlayEvent,
      lastNonZeroVolumeRef,
      rememberActiveTrack,
      resetPlaybackIntelligence,
      pullFromEngine,
      playbackDeliveryPolicy,
      pendingRestoreTimeRef,
      publishConnectState,
      queueRef,
      repeatRef,
      resumeAfterReloadRef,
      setPlaySource,
      startTrackerSession,
    ],
  );

  const play = useCallback(
    (track: Track, source?: PlaySource) => {
      startQueuePlayback(
        [track],
        0,
        source || { type: "track", name: track.title },
      );
    },
    [startQueuePlayback],
  );

  const playAll = useCallback(
    (tracks: Track[], startIndex = 0, source?: PlaySource) => {
      if (!tracks.length) return;
      const track = tracks[clampIndex(startIndex, tracks.length)];
      if (!track) return;
      startQueuePlayback(
        tracks,
        startIndex,
        source ||
          (tracks.length > 1
            ? { type: "queue", name: "Queue" }
            : { type: "track", name: track.title }),
      );
    },
    [startQueuePlayback],
  );

  const pause = useCallback(() => {
    if (isCastSessionActive()) {
      void castPause().catch((error) => {
        console.error("[cast] failed to pause:", error);
      });
      commitIsPlaying(false);
      return;
    }
    cancelSoftInterruption();
    bufferingIntentRef.current = false;
    commitIsBuffering(false);
    if (shouldUseAndroidNativePlayer()) {
      silenceGaplessEngine();
      void nativeEngine.pause().catch((error) => {
        console.error("[native-player] failed to pause:", error);
      });
      commitIsPlaying(false);
      return;
    }
    if (shouldUseImmediateTransportAction()) {
      gpPause();
      return;
    }
    void gpFadeOutAndPause(SOFT_PAUSE_FADE_MS).catch(() => {
      gpPause();
    });
  }, [
    bufferingIntentRef,
    cancelSoftInterruption,
    commitIsBuffering,
    commitIsPlaying,
  ]);

  const resume = useCallback(() => {
    if (!queueRef.current.length) return;
    if (isCastSessionActive()) {
      void castPlay().catch((error) => {
        console.error("[cast] failed to resume:", error);
      });
      commitIsPlaying(true);
      return;
    }
    cancelSoftInterruption();
    bufferingIntentRef.current = true;
    commitIsBuffering(true);
    if (shouldUseAndroidNativePlayer()) {
      silenceGaplessEngine();
      void nativeEngine.play().catch((error) => {
        console.error("[native-player] failed to resume:", error);
        commitIsBuffering(false);
      });
      return;
    }
    if (shouldUseImmediateTransportAction()) {
      gpRestoreVolume();
      gpPlay();
      return;
    }
    void gpFadeInAndPlay(SOFT_PAUSE_FADE_MS).catch(() => {
      gpRestoreVolume();
      gpPlay();
    });
  }, [
    bufferingIntentRef,
    cancelSoftInterruption,
    commitIsBuffering,
    commitIsPlaying,
    queueRef,
  ]);

  const advanceToTrack = useCallback(
    (targetIndex: number) => {
      preparePlaybackDelivery(
        queueRef.current,
        targetIndex,
        playbackDeliveryPolicy,
        { immediate: true },
      );
      const outgoing = queueRef.current[currentIndexRef.current];
      flushCurrentPlayEvent("skipped", outgoing);
      advanceCursorTo(targetIndex);
      const incoming = queueRef.current[targetIndex];
      if (incoming) startTrackerSession(incoming, playSourceRef.current);
    },
    [
      advanceCursorTo,
      currentIndexRef,
      flushCurrentPlayEvent,
      playSourceRef,
      playbackDeliveryPolicy,
      queueRef,
      startTrackerSession,
    ],
  );

  const next = useCallback(() => {
    if (jamQueueLockedRef.current) return;
    if (!queueRef.current.length) return;

    const nextIndex = currentIndexRef.current + 1;
    if (nextIndex < queueRef.current.length) {
      if (isCastSessionActive()) {
        const nextTrack = queueRef.current[nextIndex];
        if (nextTrack) {
          void startCastSession({
            track: nextTrack,
            currentTime: 0,
          }).catch((error) => {
            console.error("[cast] failed to load next track:", error);
          });
        }
        advanceToTrack(nextIndex);
        commitCurrentTime(0);
        commitIsPlaying(true);
        return;
      }
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.next().catch((error) => {
          console.error("[native-player] failed to skip next:", error);
        });
      } else {
        gpNext();
      }
      advanceToTrack(nextIndex);
      return;
    }

    if (repeatRef.current === "all" && queueRef.current.length > 0) {
      if (isCastSessionActive()) {
        const nextTrack = queueRef.current[0];
        if (nextTrack) {
          void startCastSession({
            track: nextTrack,
            currentTime: 0,
          }).catch((error) => {
            console.error("[cast] failed to wrap queue:", error);
          });
        }
        advanceToTrack(0);
        commitCurrentTime(0);
        commitIsPlaying(true);
        return;
      }
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.jumpTo(0, true).catch((error) => {
          console.error("[native-player] failed to wrap queue:", error);
        });
      } else {
        gpGotoTrack(0, true);
      }
      advanceToTrack(0);
      return;
    }

    if (continueInfinitePlayback()) {
      flushCurrentPlayEvent(
        "skipped",
        queueRef.current[currentIndexRef.current],
      );
    }
  }, [
    advanceToTrack,
    commitCurrentTime,
    commitIsPlaying,
    continueInfinitePlayback,
    currentIndexRef,
    flushCurrentPlayEvent,
    jamQueueLockedRef,
    queueRef,
    repeatRef,
  ]);

  const prev = useCallback(() => {
    if (jamQueueLockedRef.current) return;
    if (!queueRef.current.length) return;
    const activeTrack = queueRef.current[currentIndexRef.current];
    const activeTrackKey = activeTrack ? getTrackCacheKey(activeTrack) : null;
    const now = performance.now();
    const justRestartedCurrentTrack =
      !!activeTrackKey &&
      prevRestartTrackKeyRef.current === activeTrackKey &&
      now - prevRestartedAtRef.current < PREV_DOUBLE_TAP_WINDOW_MS;
    const currentPositionSeconds = Math.max(
      currentTimeRef.current,
      gpGetPosition() / 1000,
    );

    if (
      shouldRestartTrackBeforePrev({
        currentTimeSeconds: currentPositionSeconds,
        justRestartedCurrentTrack,
      })
    ) {
      if (isCastSessionActive()) {
        void castSeek(0).catch((error) => {
          console.error("[cast] failed to restart track:", error);
        });
        commitCurrentTime(0);
        markSeekPosition(0);
        prevRestartTrackKeyRef.current = activeTrackKey;
        prevRestartedAtRef.current = now;
        bufferingIntentRef.current = false;
        commitIsBuffering(false);
        return;
      }
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.seekTo(0).catch((error) => {
          console.error("[native-player] failed to restart track:", error);
        });
      } else {
        gpSeekTo(0);
      }
      commitCurrentTime(0);
      markSeekPosition(0);
      prevRestartTrackKeyRef.current = activeTrackKey;
      prevRestartedAtRef.current = now;
      bufferingIntentRef.current = false;
      commitIsBuffering(false);
      return;
    }

    if (currentIndexRef.current > 0) {
      const targetIndex = currentIndexRef.current - 1;
      clearPrevRestartLatch();
      if (isCastSessionActive()) {
        const previousTrack = queueRef.current[targetIndex];
        if (previousTrack) {
          void startCastSession({
            track: previousTrack,
            currentTime: 0,
          }).catch((error) => {
            console.error("[cast] failed to load previous track:", error);
          });
        }
        advanceToTrack(targetIndex);
        commitCurrentTime(0);
        commitIsPlaying(true);
        return;
      }
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.previous().catch((error) => {
          console.error("[native-player] failed to skip previous:", error);
        });
      } else {
        gpGotoTrack(targetIndex, true);
      }
      advanceToTrack(targetIndex);
      return;
    }

    if (repeatRef.current === "all" && queueRef.current.length > 0) {
      const wrappedIndex = queueRef.current.length - 1;
      clearPrevRestartLatch();
      if (isCastSessionActive()) {
        const previousTrack = queueRef.current[wrappedIndex];
        if (previousTrack) {
          void startCastSession({
            track: previousTrack,
            currentTime: 0,
          }).catch((error) => {
            console.error("[cast] failed to wrap previous:", error);
          });
        }
        advanceToTrack(wrappedIndex);
        commitCurrentTime(0);
        commitIsPlaying(true);
        return;
      }
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.jumpTo(wrappedIndex, true).catch((error) => {
          console.error("[native-player] failed to wrap previous:", error);
        });
      } else {
        gpGotoTrack(wrappedIndex, true);
      }
      advanceToTrack(wrappedIndex);
    }
  }, [
    advanceToTrack,
    bufferingIntentRef,
    clearPrevRestartLatch,
    commitCurrentTime,
    commitIsBuffering,
    commitIsPlaying,
    currentIndexRef,
    jamQueueLockedRef,
    currentTimeRef,
    markSeekPosition,
    prevRestartTrackKeyRef,
    prevRestartedAtRef,
    queueRef,
    repeatRef,
  ]);

  const seek = useCallback(
    (time: number) => {
      if (isCastSessionActive()) {
        void castSeek(time).catch((error) => {
          console.error("[cast] failed to seek:", error);
        });
        commitCurrentTime(time);
        markSeekPosition(time);
        return;
      }
      const shouldResumeBufferingFlow = isPlayingRef.current;
      bufferingIntentRef.current = shouldResumeBufferingFlow;
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.seekTo(time * 1000).catch((error) => {
          console.error("[native-player] failed to seek:", error);
        });
      } else {
        gpSeekTo(time * 1000);
      }
      commitCurrentTime(time);
      commitIsBuffering(shouldResumeBufferingFlow);
      markSeekPosition(time);
    },
    [
      bufferingIntentRef,
      commitCurrentTime,
      commitIsBuffering,
      isPlayingRef,
      markSeekPosition,
    ],
  );

  const setVolume = useCallback(
    (volume: number) => {
      if (isCastSessionActive()) {
        void castSetVolume(volume).catch((error) => {
          console.error("[cast] failed to set volume:", error);
        });
        setVolumeState(volume);
        if (volume > 0) {
          lastNonZeroVolumeRef.current = volume;
        }
        try {
          localStorage.setItem("listen-player-volume", String(volume));
        } catch {
          // ignore persistence failures
        }
        return;
      }
      const effectiveVolume = isNative ? 1 : volume;
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.setVolume(effectiveVolume).catch((error) => {
          console.error("[native-player] failed to set volume:", error);
        });
      }
      gpSetVolume(effectiveVolume);
      setVolumeState(effectiveVolume);
      if (effectiveVolume > 0) {
        lastNonZeroVolumeRef.current = effectiveVolume;
      }
      if (isNative) return;
      try {
        localStorage.setItem("listen-player-volume", String(effectiveVolume));
      } catch {
        // ignore persistence failures
      }
    },
    [lastNonZeroVolumeRef, setVolumeState],
  );

  const setPlaybackRate = useCallback((rate: number) => {
    const safeRate = Math.max(0.25, Math.min(rate, 4));
    if (shouldUseAndroidNativePlayer()) {
      void nativeEngine.setPlaybackRate(safeRate).catch((error) => {
        console.error("[native-player] failed to set playback rate:", error);
      });
    } else {
      gpSetPlaybackRate(safeRate);
    }
  }, []);

  const clearQueue = useCallback(() => {
    if (jamQueueLockedRef.current) return;
    if (isCastSessionActive()) {
      void castStop().catch((error) => {
        console.error("[cast] failed to stop:", error);
      });
    }
    cancelSoftInterruption();
    pendingRestoreTimeRef.current = 0;
    resumeAfterReloadRef.current = false;
    cancelRestoreAutoplay();
    bufferingIntentRef.current = false;
    resetPlaybackIntelligence();
    flushCurrentPlayEvent("interrupted");
    stopNativeEngineIfAvailable("clear queue");
    gpPause();
    gpStop();
    gpLoadQueue([], 0);
    resetEngineTrackMap();
    commitQueue([]);
    commitCurrentIndex(0);
    commitCurrentTime(0);
    commitDuration(0);
    commitIsPlaying(false);
    commitIsBuffering(false);
    setPlaySource(null);
    activatedTrackKeyRef.current = null;
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // ignore persistence failures
    }
  }, [
    activatedTrackKeyRef,
    bufferingIntentRef,
    cancelSoftInterruption,
    cancelRestoreAutoplay,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsBuffering,
    commitIsPlaying,
    commitQueue,
    flushCurrentPlayEvent,
    resetEngineTrackMap,
    jamQueueLockedRef,
    pendingRestoreTimeRef,
    resetPlaybackIntelligence,
    resumeAfterReloadRef,
    setPlaySource,
  ]);

  const toggleShuffle = useCallback(() => {
    if (jamQueueLockedRef.current) return;
    const previousQueue = queueRef.current;
    if (!previousQueue.length) {
      setShuffleState((value) => !value);
      return;
    }

    const enabling = !shuffleRef.current;
    const activeTrack = previousQueue[currentIndexRef.current];

    if (enabling) {
      unshuffledQueueRef.current = previousQueue.slice();
      const nextQueue = shuffleKeepingCurrent(
        previousQueue,
        currentIndexRef.current,
      );
      setShuffleState(true);
      pushToEngine(nextQueue, 0, {
        autoplay: isPlayingRef.current,
        positionMs: playbackPositionMs(currentTimeRef.current),
      });
      return;
    }

    const original = unshuffledQueueRef.current ?? previousQueue;
    unshuffledQueueRef.current = null;
    const nextIndex = activeTrack
      ? Math.max(
          0,
          original.findIndex(
            (track) =>
              getTrackCacheKey(track) === getTrackCacheKey(activeTrack),
          ),
        )
      : 0;

    setShuffleState(false);
    pushToEngine(original, nextIndex, {
      autoplay: isPlayingRef.current,
      positionMs: playbackPositionMs(currentTimeRef.current),
    });
  }, [
    currentTimeRef,
    currentIndexRef,
    jamQueueLockedRef,
    isPlayingRef,
    pushToEngine,
    queueRef,
    setShuffleState,
    shuffleRef,
    unshuffledQueueRef,
  ]);

  const cycleRepeat = useCallback(() => {
    if (jamQueueLockedRef.current) return;
    setRepeatState((previousMode) => {
      const nextMode =
        previousMode === "off" ? "all" : previousMode === "all" ? "one" : "off";
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine
          .setRepeat(toEngineRepeatMode(nextMode))
          .catch((error) => {
            console.error("[native-player] failed to set repeat:", error);
          });
      }
      return nextMode;
    });
  }, [jamQueueLockedRef, setRepeatState]);

  const jumpTo = useCallback(
    (index: number) => {
      if (jamQueueLockedRef.current) return;
      if (index < 0 || index >= queueRef.current.length) return;
      pendingRestoreTimeRef.current = 0;
      if (isCastSessionActive()) {
        const nextTrack = queueRef.current[index];
        if (nextTrack) {
          void startCastSession({
            track: nextTrack,
            currentTime: 0,
          }).catch((error) => {
            console.error("[cast] failed to jump:", error);
          });
        }
        advanceToTrack(index);
        commitCurrentTime(0);
        commitIsPlaying(true);
        return;
      }
      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.jumpTo(index, true).catch((error) => {
          console.error("[native-player] failed to jump:", error);
        });
      } else {
        gpGotoTrack(index, true);
      }
      advanceToTrack(index);
      commitIsPlaying(true);
    },
    [
      advanceToTrack,
      commitCurrentTime,
      commitIsPlaying,
      jamQueueLockedRef,
      pendingRestoreTimeRef,
      queueRef,
    ],
  );

  const playNext = useCallback(
    (track: Track) => {
      if (jamQueueLockedRef.current) return;
      const insertAt = currentIndexRef.current + 1;
      const nextQueue = [...queueRef.current];
      nextQueue.splice(insertAt, 0, track);

      if (shouldUseAndroidNativePlayer()) {
        void (async () => {
          const engineTrack = await toFreshEngineTrack(track, undefined, {
            target: "android-native",
          });
          return nativeEngine.insertTrack(insertAt, engineTrack);
        })().catch((error) => {
          console.error("[native-player] failed to insert track:", error);
        });
      } else {
        gpInsertTrack(insertAt, registerEngineTrack(track));
      }
      commitQueue(nextQueue);

      if (unshuffledQueueRef.current) {
        unshuffledQueueRef.current = [...unshuffledQueueRef.current, track];
      }
    },
    [
      commitQueue,
      currentIndexRef,
      jamQueueLockedRef,
      queueRef,
      registerEngineTrack,
      unshuffledQueueRef,
    ],
  );

  const addToQueue = useCallback(
    (track: Track) => {
      if (jamQueueLockedRef.current) return;
      const nextQueue = [...queueRef.current, track];
      if (shouldUseAndroidNativePlayer()) {
        void (async () => {
          const engineTrack = await toFreshEngineTrack(track, undefined, {
            target: "android-native",
          });
          return nativeEngine.appendTracks([engineTrack]);
        })().catch((error) => {
          console.error("[native-player] failed to append track:", error);
        });
      } else {
        gpAddTrack(registerEngineTrack(track));
      }
      commitQueue(nextQueue);

      if (unshuffledQueueRef.current) {
        unshuffledQueueRef.current = [...unshuffledQueueRef.current, track];
      }
    },
    [
      commitQueue,
      jamQueueLockedRef,
      queueRef,
      registerEngineTrack,
      unshuffledQueueRef,
    ],
  );

  const removeFromQueue = useCallback(
    (index: number) => {
      if (jamQueueLockedRef.current) return;
      const previousQueue = queueRef.current;
      if (index < 0 || index >= previousQueue.length) return;

      const removedTrack = previousQueue[index];
      const removingCurrent = index === currentIndexRef.current;
      const nextQueue = previousQueue.filter(
        (_, queueIndex) => queueIndex !== index,
      );

      if (unshuffledQueueRef.current && removedTrack) {
        const removedKey = getTrackCacheKey(removedTrack);
        unshuffledQueueRef.current = unshuffledQueueRef.current.filter(
          (track) => getTrackCacheKey(track) !== removedKey,
        );
      }

      if (removingCurrent) {
        flushCurrentPlayEvent("skipped");
        const nextIndex = Math.min(
          currentIndexRef.current,
          nextQueue.length - 1,
        );
        pushToEngine(nextQueue, nextIndex, {
          autoplay: isPlayingRef.current && nextQueue.length > 0,
          positionMs: 0,
        });
        return;
      }

      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.removeTrack(index).catch((error) => {
          console.error("[native-player] failed to remove track:", error);
        });
      } else {
        gpRemoveTrack(index);
        if (removedTrack) unregisterEngineTrack(removedTrack);
      }
      const nextIndex =
        index < currentIndexRef.current
          ? currentIndexRef.current - 1
          : currentIndexRef.current;
      commitQueue(nextQueue);
      if (nextIndex !== currentIndexRef.current) {
        commitCurrentIndex(nextIndex);
      }
    },
    [
      commitCurrentIndex,
      commitQueue,
      currentIndexRef,
      flushCurrentPlayEvent,
      isPlayingRef,
      jamQueueLockedRef,
      pushToEngine,
      queueRef,
      unregisterEngineTrack,
      unshuffledQueueRef,
    ],
  );

  const reorderQueue = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (jamQueueLockedRef.current) return;
      const previousQueue = queueRef.current;
      if (
        fromIndex < 0 ||
        fromIndex >= previousQueue.length ||
        toIndex < 0 ||
        toIndex >= previousQueue.length ||
        fromIndex === toIndex
      ) {
        return;
      }

      const nextQueue = [...previousQueue];
      const [moved] = nextQueue.splice(fromIndex, 1);
      if (!moved) return;
      nextQueue.splice(toIndex, 0, moved);

      if (unshuffledQueueRef.current) {
        unshuffledQueueRef.current = null;
      }

      const activeIndex = currentIndexRef.current;
      const movingCurrent = fromIndex === activeIndex;
      if (movingCurrent) {
        pushToEngine(nextQueue, toIndex, {
          autoplay: isPlayingRef.current,
          positionMs: playbackPositionMs(currentTimeRef.current),
        });
        return;
      }

      if (shouldUseAndroidNativePlayer()) {
        void nativeEngine.reorderTrack(fromIndex, toIndex).catch((error) => {
          console.error("[native-player] failed to reorder queue:", error);
        });
      } else {
        gpRemoveTrack(fromIndex);
        unregisterEngineTrack(moved);
        gpInsertTrack(toIndex, registerEngineTrack(moved));
      }

      let nextIndex = activeIndex;
      if (fromIndex < activeIndex && toIndex >= activeIndex) {
        nextIndex = activeIndex - 1;
      } else if (fromIndex > activeIndex && toIndex <= activeIndex) {
        nextIndex = activeIndex + 1;
      }

      commitQueue(nextQueue);
      if (nextIndex !== activeIndex) {
        commitCurrentIndex(nextIndex);
      }
    },
    [
      commitCurrentIndex,
      commitQueue,
      currentIndexRef,
      currentTimeRef,
      isPlayingRef,
      jamQueueLockedRef,
      pushToEngine,
      queueRef,
      registerEngineTrack,
      unregisterEngineTrack,
      unshuffledQueueRef,
    ],
  );

  const syncJamQueue = useCallback(
    (
      tracks: Track[],
      options?: {
        currentTrack?: Track | null;
        positionSeconds?: number;
        playing?: boolean;
        queueOnly?: boolean;
        forcePosition?: boolean;
        source?: PlaySource;
      },
    ) => {
      const source = options?.source ||
        playSourceRef.current || {
          type: "queue" as const,
          name: "Jam session",
        };
      if (!jamQueueLockedRef.current) {
        if (!isJamPlaybackSource(source)) return;
        ensureJamQueueLocked?.();
        if (!jamQueueLockedRef.current) return;
      }

      const plan = getJamQueueSyncPlan({
        currentQueue: queueRef.current,
        currentIndex: currentIndexRef.current,
        currentTime: currentTimeRef.current,
        isPlaying: isPlayingRef.current,
        nextQueue: tracks,
        currentTrack: options?.currentTrack,
        positionSeconds: options?.positionSeconds,
        playing: options?.playing,
      });
      const currentTrack =
        options?.currentTrack !== undefined
          ? options.currentTrack
          : queueRef.current[currentIndexRef.current];
      const nextTrack = tracks[plan.currentIndex];
      const queueOrderMatches =
        tracks.length === queueRef.current.length &&
        tracks.every((track, index) =>
          tracksMatch(track, queueRef.current[index]),
        );
      const activeTrackMatches =
        nextTrack === undefined && currentTrack == null
          ? true
          : tracksMatch(nextTrack, currentTrack);
      const currentIndexMatches = currentIndexRef.current === plan.currentIndex;

      if (!playSourcesMatch(playSourceRef.current, source)) {
        playSourceRef.current = source;
        setPlaySource(source);
      }

      if (!queueOrderMatches || !activeTrackMatches || !currentIndexMatches) {
        const jamQueueSyncRevision = ++jamQueueSyncRevisionRef.current;
        if (options?.queueOnly && activeTrackMatches && currentTrack) {
          const edits = planQueueEdits(queueRef.current, tracks);
          if (shouldUseAndroidNativePlayer()) {
            const applyNativeEdits = async () => {
              for (const edit of edits) {
                if (jamQueueSyncRevisionRef.current !== jamQueueSyncRevision) {
                  return;
                }
                if (edit.type === "remove") {
                  // Native queue indices change after each edit, so these
                  // operations must remain ordered.
                  // react-doctor-disable-next-line async-await-in-loop
                  await nativeEngine.removeTrack(edit.index);
                  if (
                    jamQueueSyncRevisionRef.current !== jamQueueSyncRevision
                  ) {
                    return;
                  }
                  unregisterEngineTrack(edit.track);
                } else {
                  const engineTrack = await toFreshEngineTrack(
                    edit.track,
                    undefined,
                    {
                      target: "android-native",
                    },
                  );
                  if (
                    jamQueueSyncRevisionRef.current !== jamQueueSyncRevision
                  ) {
                    return;
                  }
                  await nativeEngine.insertTrack(edit.index, engineTrack);
                }
              }
            };
            nativeJamQueueMutationRef.current =
              nativeJamQueueMutationRef.current
                .catch(() => undefined)
                .then(applyNativeEdits)
                .catch((error) => {
                  if (
                    jamQueueSyncRevisionRef.current === jamQueueSyncRevision
                  ) {
                    console.error(
                      "[native-player] failed to apply Jam queue update:",
                      error,
                    );
                  }
                });
          } else {
            for (const edit of edits) {
              if (edit.type === "remove") {
                gpRemoveTrack(edit.index);
                unregisterEngineTrack(edit.track);
              } else {
                gpInsertTrack(edit.index, registerEngineTrack(edit.track));
              }
            }
          }
          commitQueue(tracks);
          if (currentIndexRef.current !== plan.currentIndex) {
            commitCurrentIndex(plan.currentIndex);
          }
        } else {
          // Transport changes and initial room hydration still use the full
          // engine sync. Ordinary queue snapshots take the in-place path above
          // so they cannot restart the active media element at zero.
          const preservePlayback = tracksMatch(currentTrack, nextTrack);
          pushToEngine(tracks, plan.currentIndex, {
            autoplay: plan.playing,
            positionMs: plan.positionSeconds * 1000,
            ...(preservePlayback ? { preservePlayback: true } : {}),
          });
          return;
        }
      }

      if (options?.positionSeconds !== undefined) {
        const drift = Math.abs(
          options.positionSeconds - currentTimeRef.current,
        );
        if (
          drift >
          (options.forcePosition ? JAM_EXPLICIT_SYNC_TOLERANCE_SECONDS : 1)
        ) {
          seek(plan.positionSeconds);
        }
      }
      if (options?.playing !== undefined) {
        if (options.playing && !isPlayingRef.current) resume();
        else if (!options.playing && isPlayingRef.current) pause();
      }
    },
    [
      commitCurrentIndex,
      commitQueue,
      currentIndexRef,
      currentTimeRef,
      ensureJamQueueLocked,
      isPlayingRef,
      jamQueueLockedRef,
      pause,
      playSourceRef,
      pushToEngine,
      queueRef,
      registerEngineTrack,
      resume,
      seek,
      setPlaySource,
      unregisterEngineTrack,
    ],
  );

  return {
    play,
    playAll,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
    setPlaybackRate,
    clearQueue,
    toggleShuffle,
    cycleRepeat,
    jumpTo,
    playNext,
    addToQueue,
    removeFromQueue,
    reorderQueue,
    syncJamQueue,
  };
}
