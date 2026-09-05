import {
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  PlayerActionsContext,
  PlayerProgressContext,
  PlayerStateContext,
  type JamTransportControls,
  type PlayerActionsValue,
  type PlayerContextValue,
  type PlayerProgressValue,
  type PlayerStateValue,
} from "@/contexts/player-context";
import { clampIndex } from "@/contexts/player-queue-helpers";
import { getTrackCacheKey } from "@/contexts/player-utils";
import {
  destroyPlayer as gpDestroyPlayer,
  getTrackIndex as gpGetTrackIndex,
  getTracks as gpGetTracks,
  loadQueue as gpLoadQueue,
  play as gpPlay,
  replaceTrack as gpReplaceTrack,
  seekTo as gpSeekTo,
  setLoop as gpSetLoop,
  setSingleMode as gpSetSingleMode,
  setVolume as gpSetVolume,
} from "@/lib/gapless-player";
import {
  toFreshEngineTrack,
  toStartupEngineTracks,
} from "@/contexts/player-engine-adapter";
import { useAuth } from "@/contexts/AuthContext";
import { AUTH_RUNTIME_RESET_EVENT } from "@/contexts/auth-runtime";
import { usePlayerEngineSync } from "@/contexts/use-player-engine-sync";
import { usePlayEventTracker } from "@/contexts/use-play-event-tracker";
import { usePlaybackIntelligence } from "@/contexts/use-playback-intelligence";
import { usePlaybackPersistence } from "@/contexts/use-playback-persistence";
import { useRemotePlaybackState } from "@/contexts/use-remote-playback-state";
import { usePlayerConnectTransport } from "@/contexts/use-player-connect-transport";
import { ContinuePlaybackPrompt } from "@/components/player/ContinuePlaybackPrompt";
import { useCrateConnectEnabled } from "@/hooks/use-crate-connect-enabled";
import { useEqualizerRuntime } from "@/hooks/use-equalizer-runtime";
import { useRestoreOnMount } from "@/contexts/use-restore-on-mount";
import { usePlayerAuthSync } from "@/contexts/use-player-auth-sync";
import {
  useDesktopTrayCommands,
  useDesktopTrayNowPlaying,
} from "@/contexts/use-desktop-tray-commands";
import { usePlayerEngineCallbacks } from "@/contexts/use-player-engine-callbacks";
import {
  canApplyNextTrackResolution,
  getNextTrackIndex,
} from "@/contexts/player-next-track-resolution";
import { usePlayerQueueActions } from "@/contexts/use-player-queue-actions";
import { usePlayerRuntimeState } from "@/contexts/use-player-runtime-state";
import {
  PLAYBACK_NEEDS_USER_GESTURE_EVENT,
  useSoftInterruption,
} from "@/contexts/use-soft-interruption";
import { usePlayerShortcuts } from "@/contexts/use-player-shortcuts";
import { useMediaSession } from "@/contexts/use-media-session";
import {
  androidNativeEngine,
  shouldUseAndroidNativePlayer,
} from "@/lib/android-native-engine";
import { createQueueRevision } from "@/lib/playback-engine";
import {
  getEffectivePlaybackDeliveryPolicy,
  getPlaybackDeliveryPolicyPreference,
  subscribeToPlaybackDeliveryNetworkChanges,
} from "@/lib/player-playback-prefs";
import {
  recordPlaybackStall,
  recordStablePlayback,
} from "@/lib/playback-network-quality";
import { getPlaybackDeliveryProvenance } from "@/lib/playback-provenance";
import {
  getPlaybackQoeRuntime,
  installPlaybackQoeFlush,
  recordPlaybackQoe,
  type PlaybackQoeEventName,
} from "@/lib/playback-qoe";
import { CRATE_CONNECT_V2_TRANSPORT_ENABLED } from "@/lib/crate-connect";
import { buildPlaybackStatePayload } from "@/lib/remote-playback-state";
import { useNativePlaybackRuntime } from "@/contexts/use-native-playback-runtime";
import { useJamQueueSession } from "@/contexts/use-jam-queue-session";
import { usePlayerPreferenceRuntime } from "@/contexts/use-player-preference-runtime";
import { usePlayerIntelligenceActions } from "@/contexts/use-player-intelligence-actions";

export type { PlaySource, RepeatMode, Track } from "@/contexts/player-types";
export type { CrossfadeTransition } from "@/contexts/player-context";
export { shouldRestartTrackBeforePrev } from "@/contexts/player-queue-helpers";

export function usePlayerState(): PlayerStateValue {
  const ctx = useContext(PlayerStateContext);
  if (!ctx)
    throw new Error("usePlayerState must be used within PlayerProvider");
  return ctx;
}

export function usePlayerActions(): PlayerActionsValue {
  const ctx = useContext(PlayerActionsContext);
  if (!ctx)
    throw new Error("usePlayerActions must be used within PlayerProvider");
  return ctx;
}

export function usePlayerProgress(): PlayerProgressValue {
  const ctx = useContext(PlayerProgressContext);
  if (!ctx)
    throw new Error("usePlayerProgress must be used within PlayerProvider");
  return ctx;
}

export function usePlayer(): PlayerContextValue {
  const state = usePlayerState();
  const progress = usePlayerProgress();
  const actions = usePlayerActions();
  return { ...state, ...progress, ...actions };
}

export function PlayerProvider({ children }: { children: ReactNode }) {
  return usePlayerProviderRuntime(children);
}

function usePlayerProviderRuntime(children: ReactNode) {
  const [playbackNeedsUserGesture, setPlaybackNeedsUserGesture] =
    useState(false);
  const [jamTransport, setJamTransportState] =
    useState<JamTransportControls | null>(null);
  const setJamTransport = useCallback(
    (controls: JamTransportControls | null) => {
      setJamTransportState(controls);
    },
    [],
  );
  const {
    queue,
    currentIndex,
    jamQueueLocked,
    currentTrack,
    isPlaying,
    isBuffering,
    currentTime,
    duration,
    volume,
    analyserVersion,
    crossfadeTransition,
    shuffle,
    playSource,
    repeat,
    smartCrossfadeEnabled,
    recentlyPlayed,
    infinitePlaybackEnabled,
    smartPlaylistSuggestionsEnabled,
    smartPlaylistSuggestionsCadence,
    playbackDeliveryPolicy,
    setPlaySource,
    setRepeatState,
    setShuffleState,
    setVolumeState,
    setAnalyserVersion,
    setCrossfadeTransition,
    setSmartCrossfadeEnabled,
    setRecentlyPlayed,
    setInfinitePlaybackEnabled,
    setSmartPlaylistSuggestionsEnabled,
    setSmartPlaylistSuggestionsCadence,
    setPlaybackDeliveryPolicy,
    crossfadeTimerRef,
    queueRef,
    jamQueueLockedRef,
    currentIndexRef,
    currentTrackRef,
    repeatRef,
    shuffleRef,
    playSourceRef,
    smartCrossfadeEnabledRef,
    effectiveCrossfadeMsRef,
    isPlayingRef,
    isBufferingRef,
    currentTimeRef,
    durationRef,
    bufferingIntentRef,
    lastNonZeroVolumeRef,
    activatedTrackKeyRef,
    prevRestartTrackKeyRef,
    prevRestartedAtRef,
    callbacksRef,
    unshuffledQueueRef,
    engineTrackMapRef,
    resetEngineTrackMap,
    commitQueue,
    commitJamQueueLocked,
    buildEngineUrls,
    registerEngineTrack,
    unregisterEngineTrack,
    clearPrevRestartLatch,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsPlaying,
    commitIsBuffering,
  } = usePlayerRuntimeState();

  // queue, currentIndex, currentTrack, currentTime, duration, isPlaying are
  // kept in sync with their refs by their respective commit* helpers.
  // Only repeat, shuffle and playSource use setState directly, so mirror
  // them into refs here.
  useEffect(() => {
    repeatRef.current = repeat;
    shuffleRef.current = shuffle;
    playSourceRef.current = playSource;
    smartCrossfadeEnabledRef.current = smartCrossfadeEnabled;
  }, [
    playSource,
    repeat,
    shuffle,
    smartCrossfadeEnabled,
    playSourceRef,
    repeatRef,
    shuffleRef,
    smartCrossfadeEnabledRef,
  ]);

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
  });

  const { user: authUser } = useAuth();
  const connectEnabled = useCrateConnectEnabled();
  const connectV2Enabled = connectEnabled && CRATE_CONNECT_V2_TRANSPORT_ENABLED;
  const connectV1Enabled =
    connectEnabled && !CRATE_CONNECT_V2_TRANSPORT_ENABLED;
  usePlayerAuthSync({
    authUser,
    currentTrack,
    isPlaying,
  });
  const suppressNextConnectClaimRef = useRef(false);
  const connectV2PublishRef = useRef<
    ((options?: { claimActive?: boolean }) => Promise<void>) | null
  >(null);
  const buildConnectSnapshotPayload = useCallback(
    (
      snapshotKind: "light" | "structural",
      options?: { claimActive?: boolean },
    ) =>
      buildPlaybackStatePayload({
        currentIndex: currentIndexRef.current,
        currentTime: currentTimeRef.current,
        duration: durationRef.current,
        isPlaying: isPlayingRef.current,
        playSource: playSourceRef.current,
        queue: queueRef.current,
        repeat: repeatRef.current,
        shuffle: shuffleRef.current,
        snapshotKind,
        unshuffledQueue: unshuffledQueueRef.current,
        claimActive: options?.claimActive,
      }),
    [
      currentIndexRef,
      currentTimeRef,
      durationRef,
      isPlayingRef,
      playSourceRef,
      queueRef,
      repeatRef,
      shuffleRef,
      unshuffledQueueRef,
    ],
  );
  const { publishStructuralNow: publishConnectStateV1 } =
    useRemotePlaybackState({
      authUser,
      enabled: connectV1Enabled,
      queue,
      currentIndex,
      isPlaying,
      shuffle,
      repeat,
      playSource,
      queueRef,
      currentIndexRef,
      currentTimeRef,
      durationRef,
      isPlayingRef,
      shuffleRef,
      repeatRef,
      playSourceRef,
      unshuffledQueueRef,
      suppressNextActiveClaimRef: suppressNextConnectClaimRef,
    });
  const publishConnectState = useCallback(
    async (options?: { claimActive?: boolean }) => {
      if (connectV2Enabled) {
        await connectV2PublishRef.current?.(options);
        return;
      }
      await publishConnectStateV1(options);
    },
    [connectV2Enabled, publishConnectStateV1],
  );
  useEqualizerRuntime(currentTrack);

  const getPlaybackSnapshot = useCallback(
    () => ({
      currentTime: currentTimeRef.current,
      duration: durationRef.current,
    }),
    [currentTimeRef, durationRef],
  );

  const {
    startSession: startTrackerSession,
    ensureSession: ensureTrackerSession,
    flushCurrentPlayEvent,
    rotateSession: rotateTrackerSession,
    markSeekPosition,
    recordProgress,
  } = usePlayEventTracker(getPlaybackSnapshot);
  const recordPlaybackQualityProgress = useCallback((seconds: number) => {
    recordStablePlayback(seconds);
  }, []);
  const recordCurrentPlaybackQoe = useCallback(
    (
      event: PlaybackQoeEventName,
      details: {
        durationMs?: number;
        bufferedAheadSeconds?: number;
        attempt?: number;
      } = {},
    ) => {
      const track = currentTrackRef.current;
      if (!track) return;
      const policy = getEffectivePlaybackDeliveryPolicy(playbackDeliveryPolicy);
      const provenance = getPlaybackDeliveryProvenance(track);
      recordPlaybackQoe({
        event,
        origin:
          provenance?.origin ??
          (track.origin === "remote" ? "remote" : "local"),
        requestedPolicy: provenance?.requestedPolicy ?? policy,
        effectivePolicy: provenance?.effectivePolicy ?? policy,
        runtime: getPlaybackQoeRuntime(),
        engine: shouldUseAndroidNativePlayer() ? "media3" : "gapless",
        ...details,
      });
    },
    [currentTrackRef, playbackDeliveryPolicy],
  );
  const recoverActiveTrackRef = useRef<() => Promise<boolean>>(
    async () => false,
  );
  const nextTrackResolutionKeyRef = useRef<string | null>(null);

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
  useEffect(() => {
    return subscribeToPlaybackDeliveryNetworkChanges(() => {
      setPlaybackDeliveryPolicy(getPlaybackDeliveryPolicyPreference());
    });
  }, [setPlaybackDeliveryPolicy]);
  useEffect(() => installPlaybackQoeFlush(), []);
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

  const recoverActiveTrack = useCallback(async () => {
    const recoveryQueue = queueRef.current;
    if (recoveryQueue.length === 0) return false;
    const recoveryIndex = clampIndex(
      currentIndexRef.current,
      recoveryQueue.length,
    );
    const positionMs = Math.max(0, Math.round(currentTimeRef.current * 1000));
    const nativePlayerActive = shouldUseAndroidNativePlayer();
    const engineTracks = await toStartupEngineTracks(
      recoveryQueue,
      recoveryIndex,
      undefined,
      nativePlayerActive ? { target: "android-native" } : undefined,
    );

    if (nativePlayerActive) {
      await androidNativeEngine.loadQueue({
        revision: createQueueRevision(),
        tracks: engineTracks,
        currentIndex: recoveryIndex,
        positionMs,
        autoplay: true,
        repeat: repeatRef.current,
        crossfadeMs: effectiveCrossfadeMsRef.current,
        volume: lastNonZeroVolumeRef.current,
      });
      return true;
    }

    gpLoadQueue(
      buildEngineUrls(
        recoveryQueue,
        engineTracks.map((track) => track.url),
      ),
      recoveryIndex,
      { restartIfSameIndex: true },
    );
    if (positionMs > 0) {
      gpSeekTo(positionMs);
    }
    await gpPlay();
    return true;
  }, [
    buildEngineUrls,
    currentIndexRef,
    currentTimeRef,
    effectiveCrossfadeMsRef,
    lastNonZeroVolumeRef,
    queueRef,
    repeatRef,
  ]);

  useEffect(() => {
    recoverActiveTrackRef.current = recoverActiveTrack;
  }, [recoverActiveTrack]);

  const preResolveNextTrack = useCallback(() => {
    if (shouldUseAndroidNativePlayer()) return;

    const queueSnapshot = queueRef.current;
    const currentIndex = currentIndexRef.current;
    const nextIndex = getNextTrackIndex(
      queueSnapshot.length,
      currentIndex,
      repeatRef.current,
    );
    if (nextIndex === null) return;

    const currentTrack = queueSnapshot[currentIndex];
    const nextTrack = queueSnapshot[nextIndex];
    if (!currentTrack || !nextTrack?.globalTrackUid) return;

    const expectedUrl = gpGetTracks()[nextIndex];
    if (!expectedUrl) return;

    const resolutionKey = [
      getTrackCacheKey(currentTrack),
      getTrackCacheKey(nextTrack),
      currentIndex,
      nextIndex,
      expectedUrl,
    ].join(":");
    if (nextTrackResolutionKeyRef.current === resolutionKey) return;
    nextTrackResolutionKeyRef.current = resolutionKey;

    void toFreshEngineTrack(nextTrack)
      .then((resolvedTrack) => {
        if (resolvedTrack.url === expectedUrl) return;

        const engineUrls = gpGetTracks();
        if (
          !canApplyNextTrackResolution(
            {
              queue: queueSnapshot,
              currentIndex,
              nextIndex,
              expectedUrl,
            },
            {
              queue: queueRef.current,
              currentIndex: currentIndexRef.current,
              engineIndex: gpGetTrackIndex(),
              engineUrl: engineUrls[nextIndex],
            },
          )
        ) {
          return;
        }

        gpReplaceTrack(nextIndex, resolvedTrack.url);
        const resolvedUrls = [...engineUrls];
        resolvedUrls[nextIndex] = resolvedTrack.url;
        buildEngineUrls(queueSnapshot, resolvedUrls);
      })
      .catch((error) => {
        if (nextTrackResolutionKeyRef.current === resolutionKey) {
          nextTrackResolutionKeyRef.current = null;
        }
        console.warn("[gapless] failed to resolve next track:", error);
      });
  }, [buildEngineUrls, currentIndexRef, queueRef, repeatRef]);

  const {
    appendAndAdvance,
    appendIntelligenceTracks,
    insertSuggestionAfterCurrent,
  } = usePlayerIntelligenceActions({
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

  const { continueInfinitePlayback, resetPlaybackIntelligence } =
    usePlaybackIntelligence({
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
        appendTracks: appendIntelligenceTracks,
        insertSuggestionAfterCurrent,
        appendAndAdvance,
        setBuffering: commitIsBuffering,
      },
    });

  useNativePlaybackRuntime({
    beginSoftInterruption,
    bufferingIntentRef,
    commitCurrentIndex,
    commitCurrentTime,
    commitDuration,
    commitIsBuffering,
    commitIsPlaying,
    currentIndexRef,
    currentTimeRef,
    currentTrackRef,
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
  });

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

  // Engine already booted synchronously at render body; initialize
  // volume from the stored preference.
  useEffect(() => {
    gpSetVolume(volume);
  }, [volume]);

  useEffect(() => {
    gpSetLoop(repeat === "all");
    gpSetSingleMode(repeat === "one");
  }, [repeat]);

  // NOTE: no gpSetShuffle effect. Shuffle is handled in React by reordering
  // the queue in toggleShuffle(); the engine always plays sequentially.
  //
  // The restore-on-mount flow + autoplay timeout live in useRestoreOnMount.
  // Online/offline listeners + stall timers live in useSoftInterruption.

  const ensureJamQueueLockedRef = useRef<(() => void) | null>(null);
  const ensureJamQueueLocked = useCallback(() => {
    ensureJamQueueLockedRef.current?.();
  }, []);

  const {
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
  } = usePlayerQueueActions({
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
    playbackDeliveryPolicy: getEffectivePlaybackDeliveryPolicy(
      playbackDeliveryPolicy,
    ),
  });

  const clearQueueRef = useRef(clearQueue);
  useEffect(() => {
    clearQueueRef.current = clearQueue;
  }, [clearQueue]);

  const {
    captureQueueSnapshot,
    enterJamSession,
    leaveJamSession,
    restoreQueueSnapshot,
  } = useJamQueueSession({
    commitCurrentTime,
    commitJamQueueLocked,
    currentIndexRef,
    currentTimeRef,
    ensureJamQueueLockedRef,
    isPlayingRef,
    jamQueueLockedRef,
    playSourceRef,
    pushToEngine,
    queueRef,
    repeatRef,
    setPlaySource,
    setRepeatState,
    setShuffleState,
    shuffleRef,
    unshuffledQueueRef,
  });

  const { clearTransferPlaybackGuard, connectValue } =
    usePlayerConnectTransport({
      authUser,
      buildConnectSnapshotPayload,
      commitCurrentTime,
      commitDuration,
      connectEnabled,
      connectV1Enabled,
      connectV2Enabled,
      connectV2PublishRef,
      currentIndex,
      currentTimeRef,
      isBuffering,
      isPlaying,
      isPlayingRef,
      next,
      pendingRestoreTimeRef,
      pause,
      playSource,
      playSourceRef,
      prev,
      publishConnectState,
      pushToEngine,
      queue,
      queueRef,
      repeat,
      repeatRef,
      requireUserGestureToResume,
      resume,
      seek,
      setPlaySource,
      setRepeatState,
      setShuffleState,
      setVolume,
      shuffle,
      shuffleRef,
      suppressNextConnectClaimRef,
      unshuffledQueueRef,
      volume,
    });

  useEffect(() => {
    const handleAuthRuntimeReset = () => {
      clearQueueRef.current();
    };
    window.addEventListener(AUTH_RUNTIME_RESET_EVENT, handleAuthRuntimeReset);
    return () => {
      window.removeEventListener(
        AUTH_RUNTIME_RESET_EVENT,
        handleAuthRuntimeReset,
      );
    };
  }, []);

  useEffect(() => {
    const handleNeedsUserGesture = () => {
      setPlaybackNeedsUserGesture(true);
    };
    window.addEventListener(
      PLAYBACK_NEEDS_USER_GESTURE_EVENT,
      handleNeedsUserGesture,
    );
    return () => {
      window.removeEventListener(
        PLAYBACK_NEEDS_USER_GESTURE_EVENT,
        handleNeedsUserGesture,
      );
    };
  }, []);

  useEffect(() => {
    if (isPlaying || !currentTrack) {
      setPlaybackNeedsUserGesture(false);
    }
  }, [currentTrack, isPlaying]);

  useEffect(() => {
    return () => {
      clearTransferPlaybackGuard();
      gpDestroyPlayer();
    };
  }, [clearTransferPlaybackGuard]);

  usePlayerShortcuts({
    hasCurrentTrack: !!currentTrack,
    isPlaying,
    currentTime,
    duration,
    volume,
    lastNonZeroVolume: lastNonZeroVolumeRef.current,
    pause,
    resume,
    next,
    prev,
    seek,
    setVolume,
  });

  useDesktopTrayCommands({ isPlayingRef, pause, resume, previous: prev, next });
  useDesktopTrayNowPlaying({ currentTrack, isPlaying });

  useMediaSession({
    currentTrack,
    isPlaying,
    currentTime,
    duration,
    pause,
    resume,
    next,
    prev,
    seek,
  });

  const stateValue = useMemo<PlayerStateValue>(
    () => ({
      isPlaying,
      isBuffering,
      volume,
      analyserVersion,
      crossfadeTransition,
    }),
    [analyserVersion, crossfadeTransition, isPlaying, isBuffering, volume],
  );

  const progressValue = useMemo<PlayerProgressValue>(
    () => ({ currentTime, duration }),
    [currentTime, duration],
  );

  const actionsValue = useMemo<PlayerActionsValue>(
    () => ({
      queue,
      currentIndex,
      jamQueueLocked,
      jamTransport,
      shuffle,
      playSource,
      repeat,
      smartCrossfadeEnabled,
      recentlyPlayed,
      currentTrack,
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
      enterJamSession,
      leaveJamSession,
      setJamTransport,
      syncJamQueue,
      captureQueueSnapshot,
      restoreQueueSnapshot,
      publishConnectState,
      connect: connectValue,
    }),
    [
      queue,
      currentIndex,
      jamQueueLocked,
      jamTransport,
      shuffle,
      playSource,
      repeat,
      smartCrossfadeEnabled,
      recentlyPlayed,
      currentTrack,
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
      enterJamSession,
      leaveJamSession,
      setJamTransport,
      syncJamQueue,
      captureQueueSnapshot,
      restoreQueueSnapshot,
      publishConnectState,
      connectValue,
    ],
  );

  return (
    <PlayerActionsContext.Provider value={actionsValue}>
      <PlayerStateContext.Provider value={stateValue}>
        <PlayerProgressContext.Provider value={progressValue}>
          {children}
          <ContinuePlaybackPrompt />
          {playbackNeedsUserGesture && currentTrack ? (
            <div className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--listen-player-bottom-offset,5.5rem)+env(safe-area-inset-bottom))] z-[1600] flex justify-center sm:bottom-28">
              <button
                type="button"
                className="pointer-events-auto rounded-full border border-accent-action/30 bg-surface-canvas/95 px-4 py-3 text-sm font-semibold text-text-primary shadow-2xl shadow-cyan-950/40 backdrop-blur"
                onClick={() => {
                  setPlaybackNeedsUserGesture(false);
                  resume();
                }}
              >
                Tap to resume playback
              </button>
            </div>
          ) : null}
        </PlayerProgressContext.Provider>
      </PlayerStateContext.Provider>
    </PlayerActionsContext.Provider>
  );
}
