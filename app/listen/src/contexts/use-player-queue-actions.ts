import {
  useCallback,
  useRef,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
import {
  loadQueue as gpLoadQueue,
  pause as gpPause,
  stop as gpStop,
} from "@/lib/gapless-player";
import {
  androidNativeEngine as nativeEngine,
  isAndroidNativePlayerAvailable,
} from "@/lib/android-native-engine";
import type { PlaybackDeliveryPolicy } from "@/lib/player-playback-prefs";
import { usePlayerJamQueueSync } from "@/contexts/use-player-jam-queue-sync";
import { usePlayerNavigationActions } from "@/contexts/use-player-navigation-actions";
import { usePlayerQueueMutationActions } from "@/contexts/use-player-queue-mutation-actions";
import { usePlayerQueueStateActions } from "@/contexts/use-player-queue-state-actions";
import { usePlayerStartActions } from "@/contexts/use-player-start-actions";
import { usePlayerTransportControls } from "@/contexts/use-player-transport-controls";

import type {
  PlaybackQueueReadiness,
  PlaybackResumeOptions,
} from "./playback-intelligence-model";

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

interface UsePlayerQueueActionsParams {
  queueReadinessRef?: MutableRefObject<PlaybackQueueReadiness>;
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
  resumePlaybackIntelligence?: (
    options?: PlaybackResumeOptions,
  ) => boolean | void;
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
  queueReadinessRef,
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
  resumePlaybackIntelligence,
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
  const fallbackReadinessRef = useRef<PlaybackQueueReadiness>({
    ready: true,
    generation: 0,
  });
  const readinessRef = queueReadinessRef ?? fallbackReadinessRef;
  const cancelQueuePreparation = useCallback(() => {
    if (!readinessRef.current.ready) readinessRef.current.generation++;
  }, [readinessRef]);
  const resumePendingQueue = useCallback(() => {
    const pending = readinessRef.current.resumePending;
    if (readinessRef.current.ready || !pending) return false;
    const source = playSourceRef.current;
    const preparation = pending();
    const generation = readinessRef.current.generation;
    if (preparation) {
      void preparation
        .then((recovered) => {
          if (
            recovered &&
            isPlayingRef.current &&
            generation === readinessRef.current.generation &&
            readinessRef.current.ready &&
            source === playSourceRef.current
          )
            resumePlaybackIntelligence?.({ userGesture: true });
        })
        .catch((error) => {
          console.error("[gapless] failed to resume queue recovery:", error);
        });
    }
    return true;
  }, [isPlayingRef, playSourceRef, readinessRef, resumePlaybackIntelligence]);
  const resetQueuePlayback = useCallback(() => {
    cancelQueuePreparation();
    readinessRef.current.resumePending = undefined;
    readinessRef.current.ready = true;
    resetPlaybackIntelligence();
  }, [cancelQueuePreparation, readinessRef, resetPlaybackIntelligence]);
  const { play, playAll } = usePlayerStartActions({
    queueReadinessRef: readinessRef,
    isPlayingRef,
    resumePlaybackIntelligence,
    queueRef,
    currentIndexRef,
    jamQueueLockedRef,
    repeatRef,
    shuffleRef,
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
    resumePlaybackIntelligence,
    playbackDeliveryPolicy,
  });

  const { clearQueue, toggleShuffle, cycleRepeat, setRepeatMode } =
    usePlayerQueueStateActions({
      queueRef,
      currentIndexRef,
      currentTimeRef,
      isPlayingRef,
      jamQueueLockedRef,
      repeatRef,
      shuffleRef,
      unshuffledQueueRef,
      bufferingIntentRef,
      pendingRestoreTimeRef,
      resumeAfterReloadRef,
      activatedTrackKeyRef,
      setPlaySource,
      setShuffleState,
      setRepeatState,
      resetEngineTrackMap,
      flushCurrentPlayEvent,
      cancelSoftInterruption,
      cancelRestoreAutoplay,
      resetPlaybackIntelligence: resetQueuePlayback,
      commitQueue,
      commitCurrentIndex,
      commitCurrentTime,
      commitDuration,
      commitIsPlaying,
      commitIsBuffering,
      pushToEngine,
      silenceGaplessEngine,
      stopNativeEngineIfAvailable,
    });

  const {
    pause,
    pauseLocal,
    resume,
    resumeLocal,
    seek,
    setVolume,
    setPlaybackRate,
  } = usePlayerTransportControls({
    cancelQueuePreparation,
    resumePendingQueue,
    resetPlaybackIntelligence,
    resumePlaybackIntelligence,
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
      repeatRef,
      shuffleRef,
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
    pauseLocal,
    resume,
    resumeLocal,
    next,
    prev,
    seek,
    setVolume,
    setPlaybackRate,
    clearQueue,
    toggleShuffle,
    cycleRepeat,
    setRepeatMode,
    jumpTo,
    playNext,
    addToQueue,
    removeFromQueue,
    reorderQueue,
    syncJamQueue,
  };
}
