import {
  useCallback,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import {
  getPosition as gpGetPosition,
  loadQueue as gpLoadQueue,
  pause as gpPause,
  stop as gpStop,
} from "@/lib/gapless-player";
import { shuffleKeepingCurrent } from "@/contexts/player-queue-helpers";
import { getTrackCacheKey, STORAGE_KEY } from "@/contexts/player-utils";
import {
  androidNativeEngine as nativeEngine,
  isAndroidNativePlayerAvailable,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import type { PlaybackDeliveryPolicy } from "@/lib/player-playback-prefs";
import { usePlayerJamQueueSync } from "@/contexts/use-player-jam-queue-sync";
import { usePlayerNavigationActions } from "@/contexts/use-player-navigation-actions";
import { usePlayerQueueMutationActions } from "@/contexts/use-player-queue-mutation-actions";
import { usePlayerStartActions } from "@/contexts/use-player-start-actions";
import type { EngineRepeatMode } from "@/lib/playback-engine";
import { castStop, isCastSessionActive } from "@/lib/cast-sender";
import { usePlayerTransportControls } from "@/contexts/use-player-transport-controls";

function toEngineRepeatMode(repeat: RepeatMode): EngineRepeatMode {
  return repeat;
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
  const { play, playAll } = usePlayerStartActions({
    queueRef,
    currentIndexRef,
    jamQueueLockedRef,
    repeatRef,
    bufferingIntentRef,
    pendingRestoreTimeRef,
    resumeAfterReloadRef,
    lastNonZeroVolumeRef,
    setPlaySource,
    buildEngineUrls,
    rememberActiveTrack,
    startTrackerSession,
    flushCurrentPlayEvent,
    cancelSoftInterruption,
    cancelRestoreAutoplay,
    resetPlaybackIntelligence,
    commitQueue,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsPlaying,
    commitIsBuffering,
    pullFromEngine,
    publishConnectState,
    playbackDeliveryPolicy,
    silenceGaplessEngine,
    stopNativeEngineIfAvailable,
  });

  const { next, prev, jumpTo } = usePlayerNavigationActions({
    queueRef,
    currentIndexRef,
    currentTimeRef,
    jamQueueLockedRef,
    repeatRef,
    playSourceRef,
    bufferingIntentRef,
    pendingRestoreTimeRef,
    prevRestartTrackKeyRef,
    prevRestartedAtRef,
    commitCurrentTime,
    commitIsPlaying,
    commitIsBuffering,
    markSeekPosition,
    clearPrevRestartLatch,
    flushCurrentPlayEvent,
    advanceCursorTo,
    startTrackerSession,
    continueInfinitePlayback,
    playbackDeliveryPolicy,
  });

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

  const { pause, resume, seek, setVolume, setPlaybackRate } =
    usePlayerTransportControls({
      queueRef,
      isPlayingRef,
      bufferingIntentRef,
      lastNonZeroVolumeRef,
      commitIsPlaying,
      commitIsBuffering,
      commitCurrentTime,
      setVolumeState,
      markSeekPosition,
      cancelSoftInterruption,
      silenceGaplessEngine,
    });

  const { addToQueue, playNext, removeFromQueue, reorderQueue } =
    usePlayerQueueMutationActions({
      queueRef,
      jamQueueLockedRef,
      currentIndexRef,
      currentTimeRef,
      isPlayingRef,
      unshuffledQueueRef,
      registerEngineTrack,
      unregisterEngineTrack,
      commitQueue,
      commitCurrentIndex,
      flushCurrentPlayEvent,
      pushToEngine,
    });

  const { syncJamQueue } = usePlayerJamQueueSync({
    queueRef,
    jamQueueLockedRef,
    currentIndexRef,
    currentTimeRef,
    isPlayingRef,
    playSourceRef,
    setPlaySource,
    ensureJamQueueLocked,
    commitQueue,
    commitCurrentIndex,
    pushToEngine,
    registerEngineTrack,
    unregisterEngineTrack,
    seek,
    pause,
    resume,
  });

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
