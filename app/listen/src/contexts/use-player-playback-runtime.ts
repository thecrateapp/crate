import { useEffect } from "react";
import {
  androidNativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import { continuationDescriptor } from "@/lib/playback-continuation";
import { getEffectivePlaybackDeliveryPolicy } from "@/lib/player-playback-prefs";
import { getSmartMixCapabilities } from "@/lib/smart-mix";

import { usePlaybackIntelligence } from "@/contexts/use-playback-intelligence";
import { usePlaybackPersistence } from "@/contexts/use-playback-persistence";
import { usePlayerEngineCallbacks } from "@/contexts/use-player-engine-callbacks";
import { usePlayerEnginePreferenceRuntime } from "@/contexts/use-player-engine-preference-runtime";
import { usePlayerEngineSync } from "@/contexts/use-player-engine-sync";
import { usePlayerIntelligenceActions } from "@/contexts/use-player-intelligence-actions";
import { useNativeContinuationAdoption } from "@/contexts/use-native-continuation-adoption";
import { useNativePlaybackRuntime } from "@/contexts/use-native-playback-runtime";
import { usePlayerPlaybackObservability } from "@/contexts/use-player-playback-observability";
import { usePlayerPreferenceRuntime } from "@/contexts/use-player-preference-runtime";
import { usePlayerTrackRecovery } from "@/contexts/use-player-track-recovery";
import { useRestoreOnMount } from "@/contexts/use-restore-on-mount";
import { useSoftInterruption } from "@/contexts/use-soft-interruption";
import { useEqualizerRuntime } from "@/hooks/use-equalizer-runtime";
import { recordPlaybackStall } from "@/lib/playback-network-quality";

import type { usePlayerRuntimeState } from "./use-player-runtime-state";

export type PlayerPlaybackRuntimeState = ReturnType<
  typeof usePlayerRuntimeState
>;

export function usePlayerPlaybackRuntime({
  connectEnabled,
  runtime,
}: {
  connectEnabled: boolean;
  runtime: PlayerPlaybackRuntimeState;
}) {
  const {
    queue,
    currentIndex,
    currentTrack,
    isPlaying,
    volume,
    playSource,
    repeat,
    shuffle,
    smartCrossfadeEnabled,
    recentlyPlayed,
    infinitePlaybackEnabled,
    smartPlaylistSuggestionsEnabled,
    smartPlaylistSuggestionsCadence,
    playbackDeliveryPolicy,
    playSourceRef,
    repeatRef,
    shuffleRef,
    smartCrossfadeEnabledRef,
    effectiveCrossfadeMsRef,
    queueRef,
    queueReadinessRef,
    currentIndexRef,
    currentTrackRef,
    isPlayingRef,
    isBufferingRef,
    currentTimeRef,
    durationRef,
    bufferingIntentRef,
    lastNonZeroVolumeRef,
    activatedTrackKeyRef,
    callbacksRef,
    unshuffledQueueRef,
    engineTrackMapRef,
    crossfadeTimerRef,
    commitQueue,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsPlaying,
    commitIsBuffering,
    setAnalyserVersion,
    setCrossfadeTransition,
    setMixState,
    setRecentlyPlayed,
    setPlaybackDeliveryPolicy,
    setInfinitePlaybackEnabled,
    setSmartCrossfadeEnabled,
    setSmartPlaylistSuggestionsEnabled,
    setSmartPlaylistSuggestionsCadence,
    buildEngineUrls,
    registerEngineTrack,
    clearPrevRestartLatch,
  } = runtime;

  usePlayerEnginePreferenceRuntime({
    playSource,
    repeat,
    shuffle,
    smartCrossfadeEnabled,
    volume,
    playSourceRef,
    repeatRef,
    shuffleRef,
    smartCrossfadeEnabledRef,
  });

  usePlaybackPersistence({
    queue,
    currentIndex,
    isPlaying,
    shuffle,
    queueRef,
    currentIndexRef,
    currentTimeRef,
    isPlayingRef,
    shuffleRef,
    unshuffledQueueRef,
    playSource,
    playSourceRef,
  });

  useEqualizerRuntime(currentTrack);

  const {
    startTrackerSession,
    ensureTrackerSession,
    flushCurrentPlayEvent,
    rotateTrackerSession,
    markSeekPosition,
    recordProgress,
    recordPlaybackQualityProgress,
    recordCurrentPlaybackQoe,
  } = usePlayerPlaybackObservability({
    currentTrackRef,
    currentTimeRef,
    durationRef,
    playbackDeliveryPolicy,
    setPlaybackDeliveryPolicy,
  });
  const { preResolveNextTrack, recoverActiveTrackRef } = usePlayerTrackRecovery(
    {
      buildEngineUrls,
      currentIndexRef,
      currentTimeRef,
      effectiveCrossfadeMsRef,
      lastNonZeroVolumeRef,
      playSourceRef,
      queueRef,
      repeatRef,
      shuffleRef,
    },
  );

  const {
    beginSoftInterruption,
    cancelSoftInterruption,
    requireUserGestureToResume,
    scheduleStallProtection,
    clearStallTimer,
    isSoftInterrupted,
  } = useSoftInterruption({
    currentTrackRef,
    isPlayingRef,
    isBufferingRef,
    bufferingIntentRef,
    commitIsPlaying,
    commitIsBuffering,
    onPlaybackStall: () => {
      recordPlaybackStall();
      recordCurrentPlaybackQoe("stall_start");
    },
    onPlaybackStallEnded: (durationMs, bufferedAheadSeconds) => {
      recordCurrentPlaybackQoe("stall_end", {
        durationMs,
        bufferedAheadSeconds,
      });
    },
    onPlaybackRecovered: (attempt) => {
      recordCurrentPlaybackQoe("recovery", { attempt });
    },
    recoverCurrentTrack: () => recoverActiveTrackRef.current(),
  });
  const {
    syncEffectiveCrossfade,
    rememberActiveTrack,
    pullFromEngine,
    pushToEngine,
    advanceCursorTo,
  } = usePlayerEngineSync({
    queueRef,
    currentIndexRef,
    currentTrackRef,
    repeatRef,
    shuffleRef,
    playSourceRef,
    smartCrossfadeEnabledRef,
    effectiveCrossfadeMsRef,
    isPlayingRef,
    durationRef,
    bufferingIntentRef,
    activatedTrackKeyRef,
    engineTrackMapRef,
    setRecentlyPlayed,
    commitQueue,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsPlaying,
    commitIsBuffering,
    buildEngineUrls,
    clearPrevRestartLatch,
    markSeekPosition,
  });

  const {
    adoptNativeTracks,
    appendAndAdvance,
    appendIntelligenceTracks,
    insertSuggestionAfterCurrent,
  } = usePlayerIntelligenceActions({
    queueReadinessRef,
    repeatRef,
    shuffleRef,
    advanceCursorTo,
    commitIsBuffering,
    commitIsPlaying,
    commitQueue,
    currentIndexRef,
    flushCurrentPlayEvent,
    playSourceRef,
    queueRef,
    recentlyPlayed,
    registerEngineTrack,
    startTrackerSession,
    unshuffledQueueRef,
  });

  const adoptNativeAppendedTracks = useNativeContinuationAdoption({
    queueReadinessRef,
    adoptTracks: adoptNativeTracks,
    queueRef,
    playSourceRef,
  });

  const {
    continueInfinitePlayback,
    recoverAtEnd,
    resumePlaybackIntelligence,
    resetPlaybackIntelligence,
  } = usePlaybackIntelligence({
    queueReadinessRef,
    stateRefs: { queueRef, playSourceRef, currentIndexRef },
    repeat,
    queue,
    currentIndex,
    isPlaying,
    playSource,
    shuffle,
    infinitePlaybackEnabled,
    smartPlaylistSuggestionsEnabled,
    smartPlaylistSuggestionsCadence,
    recentlyPlayed,
    actions: {
      synchronizeContinuation: adoptNativeAppendedTracks,
      publishContinuationCursor: (source, authoritative) => {
        const radio = source.radio;
        if (
          !shouldUseAndroidNativePlayer() ||
          source !== playSourceRef.current ||
          !radio?.continuationSessionId ||
          !queueReadinessRef.current.ready
        )
          return;
        return androidNativeEngine.setContinuationCursor(
          {
            sessionId: radio.continuationSessionId,
            batchIndex: radio.continuationBatchIndex ?? 0,
            revision: radio.continuationRevision ?? 1,
          },
          authoritative,
        );
      },
      appendTracks: appendIntelligenceTracks,
      insertSuggestionAfterCurrent,
      appendAndAdvance,
      setBuffering: commitIsBuffering,
    },
  });

  useNativePlaybackRuntime({
    recoverAtEnd,
    resumePlaybackIntelligence,
    resetPlaybackIntelligence,
    adoptNativeAppendedTracks,
    beginSoftInterruption,
    bufferingIntentRef,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsBuffering,
    commitIsPlaying,
    crossfadeTimerRef,
    currentIndexRef,
    currentTimeRef,
    currentTrackRef,
    durationRef,
    effectiveCrossfadeMsRef,
    ensureTrackerSession,
    flushCurrentPlayEvent,
    lastNonZeroVolumeRef,
    playSourceRef,
    queueRef,
    recordProgress,
    rememberActiveTrack,
    repeatRef,
    rotateTrackerSession,
    setCrossfadeTransition,
    setMixState,
    shuffleRef,
  });

  useEffect(() => {
    if (!shouldUseAndroidNativePlayer() || !queueReadinessRef.current.ready)
      return;
    const capabilities = getSmartMixCapabilities();
    void androidNativeEngine
      .setContinuationContext({
        source: shuffle
          ? "shuffle"
          : playSource?.type === "radio"
            ? "radio"
            : "infinite",
        preferredDurationMs: effectiveCrossfadeMsRef.current,
        allowBeatmatch: capabilities.androidBeatmatch,
        allowBassHandoff: capabilities.androidBassHandoff,
        allowLongBeatmatch: capabilities.androidLongBeatmatch,
        delivery: getEffectivePlaybackDeliveryPolicy(playbackDeliveryPolicy),
        descriptor:
          repeat === "off"
            ? continuationDescriptor(playSource, {
                shuffle,
                infinite: infinitePlaybackEnabled,
              })
            : null,
      })
      .catch((error) =>
        console.warn(
          "[native-player] continuation configuration failed:",
          error,
        ),
      );
  }, [
    playSource,
    repeat,
    shuffle,
    infinitePlaybackEnabled,
    smartCrossfadeEnabled,
    playbackDeliveryPolicy,
    effectiveCrossfadeMsRef,
    queueReadinessRef,
  ]);

  usePlayerPreferenceRuntime({
    currentIndex,
    playbackDeliveryPolicy,
    playSource,
    queue,
    repeat,
    setInfinitePlaybackEnabled,
    setPlaybackDeliveryPolicy,
    setSmartCrossfadeEnabled,
    setSmartPlaylistSuggestionsCadence,
    setSmartPlaylistSuggestionsEnabled,
    shuffle,
    smartCrossfadeEnabled,
    syncEffectiveCrossfade,
  });

  const {
    pendingRestoreTimeRef,
    resumeAfterReloadRef,
    tryRestoreAutoplay,
    cancelRestoreAutoplay,
  } = useRestoreOnMount({
    isPlayingRef,
    queueRef,
    repeatRef,
    bufferingIntentRef,
    buildEngineUrls,
    pullFromEngine,
    pushToEngine,
    commitIsBuffering,
    commitCurrentTime,
    markSeekPosition,
    allowAutoplayRestore: !connectEnabled,
  });
  usePlayerEngineCallbacks({
    resumePlaybackIntelligence,
    continueInfinitePlayback: recoverAtEnd,
    callbacksRef,
    crossfadeTimerRef,
    currentIndexRef,
    currentTrackRef,
    playSourceRef,
    durationRef,
    effectiveCrossfadeMsRef,
    isPlayingRef,
    bufferingIntentRef,
    pendingRestoreTimeRef,
    resumeAfterReloadRef,
    engineTrackMapRef,
    queueRef,
    commitCurrentTime,
    commitDuration,
    commitIsPlaying,
    commitIsBuffering,
    clearPrevRestartLatch,
    clearStallTimer,
    scheduleStallProtection,
    cancelRestoreAutoplay,
    tryRestoreAutoplay,
    cancelSoftInterruption,
    requireUserGestureToResume,
    beginSoftInterruption,
    isSoftInterrupted,
    ensureTrackerSession,
    rotateTrackerSession,
    markSeekPosition,
    recordProgress,
    recordPlaybackQualityProgress,
    recordPlaybackStarted: (durationMs) => {
      recordCurrentPlaybackQoe("startup", { durationMs });
    },
    onActivePlaybackStarted: preResolveNextTrack,
    pullFromEngine,
    setAnalyserVersion,
    setCrossfadeTransition,
  });

  return {
    advanceCursorTo,
    appendAndAdvance,
    beginSoftInterruption,
    cancelRestoreAutoplay,
    cancelSoftInterruption,
    continueInfinitePlayback,
    recoverAtEnd,
    resumePlaybackIntelligence,
    flushCurrentPlayEvent,
    markSeekPosition,
    pullFromEngine,
    pushToEngine,
    rememberActiveTrack,
    resetPlaybackIntelligence,
    resumeAfterReloadRef,
    pendingRestoreTimeRef,
    requireUserGestureToResume,
    startTrackerSession,
  };
}
