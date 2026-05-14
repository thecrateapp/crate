import {
  useContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { Track } from "@/contexts/player-types";
import {
  PlayerActionsContext,
  PlayerProgressContext,
  PlayerStateContext,
  type PlayerActionsValue,
  type PlayerContextValue,
  type PlayerProgressValue,
  type PlayerStateValue,
} from "@/contexts/player-context";
import {} from "@/contexts/player-queue-helpers";
import { getTrackCacheKey, getStreamUrl } from "@/contexts/player-utils";
import {
  addTrack as gpAddTrack,
  destroyPlayer as gpDestroyPlayer,
  gotoTrack as gpGotoTrack,
  insertTrack as gpInsertTrack,
  setLoop as gpSetLoop,
  setSingleMode as gpSetSingleMode,
  setVolume as gpSetVolume,
} from "@/lib/gapless-player";
import {
  toEngineTrack,
  toEngineTracks,
} from "@/contexts/player-engine-adapter";
import { useAuth } from "@/contexts/AuthContext";
import { AUTH_RUNTIME_RESET_EVENT } from "@/contexts/auth-runtime";
import { usePlayerEngineSync } from "@/contexts/use-player-engine-sync";
import { usePlayEventTracker } from "@/contexts/use-play-event-tracker";
import { usePlaybackIntelligence } from "@/contexts/use-playback-intelligence";
import { usePlaybackPersistence } from "@/contexts/use-playback-persistence";
import { useEqualizerRuntime } from "@/hooks/use-equalizer-runtime";
import { useRestoreOnMount } from "@/contexts/use-restore-on-mount";
import { usePlayerAuthSync } from "@/contexts/use-player-auth-sync";
import {
  useDesktopTrayCommands,
  useDesktopTrayNowPlaying,
} from "@/contexts/use-desktop-tray-commands";
import { usePlayerEngineCallbacks } from "@/contexts/use-player-engine-callbacks";
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
import type {
  EngineEventMap,
  EngineEventName,
  EnginePositionEvent,
  EngineState,
} from "@/lib/playback-engine";
import {
  getInfinitePlaybackPreference,
  getPlaybackDeliveryPolicyPreference,
  getSmartCrossfadePreference,
  getSmartPlaylistSuggestionsCadencePreference,
  getSmartPlaylistSuggestionsPreference,
  PLAYER_PLAYBACK_PREFS_EVENT,
  type PlaybackDeliveryPolicy,
} from "@/lib/player-playback-prefs";
import { preparePlaybackDelivery } from "@/lib/playback-delivery";
import { toast } from "sonner";

const NATIVE_BUFFERING_WATCHDOG_MS = 12000;
const NATIVE_PLAYBACK_DIAGNOSTIC_KEY = "listen-native-playback-diagnostic";

function nativeTransitionFlushReason(
  reason: string | undefined,
  fromIndex: number,
  toIndex: number,
  queueLength: number,
  repeat: string,
): "completed" | "skipped" | null {
  if (reason === "playlist") return null;
  if (reason === "auto" || reason === "repeat") return "completed";
  const movedToSequentialNext =
    toIndex === fromIndex + 1 ||
    (repeat === "all" && fromIndex === queueLength - 1 && toIndex === 0);
  return movedToSequentialNext ? "completed" : "skipped";
}

function nativeMsToSeconds(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, value / 1000)
    : 0;
}

function projectedNativePositionSeconds(
  positionMs: number | null | undefined,
  nativeTimeMs: number | null | undefined,
  isPlaying: boolean,
  durationMs?: number | null,
): number {
  const positionSeconds = nativeMsToSeconds(positionMs);
  if (
    !isPlaying ||
    typeof nativeTimeMs !== "number" ||
    !Number.isFinite(nativeTimeMs)
  ) {
    return positionSeconds;
  }
  const elapsedSeconds = Math.max(0, (Date.now() - nativeTimeMs) / 1000);
  const projected = positionSeconds + elapsedSeconds;
  const durationSeconds = nativeMsToSeconds(durationMs);
  return durationSeconds > 0 ? Math.min(projected, durationSeconds) : projected;
}

function trackDurationSeconds(track: Track | undefined): number {
  return typeof track?.duration === "number" &&
    Number.isFinite(track.duration) &&
    track.duration > 0
    ? track.duration
    : 0;
}

function redactDiagnosticUrl(url: string | undefined): string {
  if (!url) return "";
  return url.replace(/([?&]token=)[^&]+/g, "$1<redacted>");
}

function persistNativePlaybackDiagnostic(payload: Record<string, unknown>) {
  try {
    localStorage.setItem(
      NATIVE_PLAYBACK_DIAGNOSTIC_KEY,
      JSON.stringify({
        at: new Date().toISOString(),
        ...payload,
      }),
    );
  } catch {
    // Diagnostics are best-effort.
  }
}

function nativePlaybackErrorMessage(error: EngineEventMap["error"]): string {
  if (typeof error.httpStatus === "number") {
    return `HTTP ${error.httpStatus}`;
  }
  if (error.causeMessage) return error.causeMessage;
  if (error.message) return error.message;
  if (error.cause) return error.cause;
  return "Unknown native playback error";
}

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
  const [playbackNeedsUserGesture, setPlaybackNeedsUserGesture] =
    useState(false);
  const {
    queue,
    currentIndex,
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
  const nativeBufferingWatchdogRef = useRef<number | null>(null);
  const nativeBufferingProbeIdRef = useRef(0);

  // queue, currentIndex, currentTrack, currentTime, duration, isPlaying are
  // kept in sync with their refs by their respective commit* helpers.
  // Only repeat, shuffle and playSource use setState directly, so mirror
  // them into refs here.
  useEffect(() => {
    repeatRef.current = repeat;
    shuffleRef.current = shuffle;
    playSourceRef.current = playSource;
    smartCrossfadeEnabledRef.current = smartCrossfadeEnabled;
  }, [playSource, repeat, shuffle, smartCrossfadeEnabled]);

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
  usePlayerAuthSync({
    authUser,
    currentTrack,
    isPlaying,
  });
  useEqualizerRuntime(currentTrack);

  const getPlaybackSnapshot = useCallback(
    () => ({
      currentTime: currentTimeRef.current,
      duration: durationRef.current,
    }),
    [],
  );

  const {
    startSession: startTrackerSession,
    ensureSession: ensureTrackerSession,
    flushCurrentPlayEvent,
    rotateSession: rotateTrackerSession,
    markSeekPosition,
    recordProgress,
  } = usePlayEventTracker(getPlaybackSnapshot);

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

  // Domain-level actions for usePlaybackIntelligence. Verb-oriented
  // instead of raw state setters — the hook no longer needs to reason
  // about engine sync, de-duplication or playback sequencing.
  const appendIntelligenceTracks = useCallback(
    (tracks: Track[]) => {
      const queue = queueRef.current;
      const existingKeys = new Set(
        [...queue, ...recentlyPlayed].map((t) => getTrackCacheKey(t)),
      );
      const unique: Track[] = [];
      for (const track of tracks) {
        const key = getTrackCacheKey(track);
        if (!key || existingKeys.has(key)) continue;
        existingKeys.add(key);
        unique.push(track);
      }
      if (unique.length === 0) return;

      const nextQueue = [...queue, ...unique];
      const nativePlayerActive = shouldUseAndroidNativePlayer();
      if (nativePlayerActive) {
        void androidNativeEngine
          .appendTracks(toEngineTracks(unique))
          .catch((error) => {
            console.error(
              "[native-player] failed to append intelligence tracks:",
              error,
            );
          });
      } else {
        for (const track of unique) {
          gpAddTrack(registerEngineTrack(track));
        }
      }
      commitQueue(nextQueue);

      // Keep the un-shuffled snapshot in sync so restoring original order
      // later (toggle shuffle off / reload after shuffle-on session) doesn't
      // silently drop radio-refill or continuation tracks fetched while
      // shuffle was active.
      if (unshuffledQueueRef.current) {
        unshuffledQueueRef.current = [...unshuffledQueueRef.current, ...unique];
      }
    },
    [commitQueue, recentlyPlayed, registerEngineTrack],
  );

  const insertSuggestionAfterCurrent = useCallback(
    (candidates: Track[]) => {
      const queue = queueRef.current;
      const insertionIndex = currentIndexRef.current + 1;
      if (insertionIndex <= 0 || insertionIndex > queue.length) return;
      if (queue[insertionIndex]?.isSuggested) return;

      const existingKeys = new Set(
        [...queue, ...recentlyPlayed].map((t) => getTrackCacheKey(t)),
      );
      const suggestion = candidates.find((t) => {
        const k = getTrackCacheKey(t);
        return !!k && !existingKeys.has(k);
      });
      if (!suggestion) return;

      const marked: Track = {
        ...suggestion,
        isSuggested: true,
        suggestionSource: "playlist",
      };
      const nextQueue = [...queue];
      nextQueue.splice(insertionIndex, 0, marked);
      if (shouldUseAndroidNativePlayer()) {
        void androidNativeEngine
          .insertTrack(insertionIndex, toEngineTrack(marked))
          .catch((error) => {
            console.error(
              "[native-player] failed to insert suggested track:",
              error,
            );
          });
      } else {
        gpInsertTrack(insertionIndex, registerEngineTrack(marked));
      }
      commitQueue(nextQueue);

      // Mirror into the un-shuffled snapshot. We don't know where the
      // suggestion would live in the original sequence, so we append it
      // at the end — good enough for restore fidelity (no track lost).
      if (unshuffledQueueRef.current) {
        unshuffledQueueRef.current = [...unshuffledQueueRef.current, marked];
      }
    },
    [commitQueue, recentlyPlayed, registerEngineTrack],
  );

  const appendAndAdvance = useCallback(
    (tracks: Track[]) => {
      const queue = queueRef.current;
      const existingKeys = new Set(
        [...queue, ...recentlyPlayed].map((t) => getTrackCacheKey(t)),
      );
      const unique: Track[] = [];
      for (const track of tracks) {
        const key = getTrackCacheKey(track);
        if (!key || existingKeys.has(key)) continue;
        existingKeys.add(key);
        unique.push(track);
      }
      if (unique.length === 0) {
        commitIsBuffering(false);
        return;
      }

      const nextQueue = [...queue, ...unique];
      const nativePlayerActive = shouldUseAndroidNativePlayer();
      if (nativePlayerActive) {
        void androidNativeEngine
          .appendTracks(toEngineTracks(unique))
          .then(() => {
            void androidNativeEngine.jumpTo(queue.length, true);
          })
          .catch((error) => {
            console.error(
              "[native-player] failed to append and advance:",
              error,
            );
          });
      } else {
        for (const track of unique) {
          gpAddTrack(registerEngineTrack(track));
        }
      }
      commitQueue(nextQueue);

      // Mirror into the un-shuffled snapshot so shuffle-off/reload
      // doesn't drop the freshly-fetched continuation tracks.
      if (unshuffledQueueRef.current) {
        unshuffledQueueRef.current = [...unshuffledQueueRef.current, ...unique];
      }

      // Advance to the first newly appended track. The old session is
      // ending by user request (they hit next at the end of the album),
      // so flush it explicitly before starting the new one.
      const nextIndex = queue.length;
      const outgoing = queueRef.current[currentIndexRef.current];
      flushCurrentPlayEvent("skipped", outgoing);
      if (!nativePlayerActive) {
        gpGotoTrack(nextIndex, true);
      }
      advanceCursorTo(nextIndex);
      const incoming = nextQueue[nextIndex];
      if (incoming) startTrackerSession(incoming, playSourceRef.current);
      commitIsPlaying(true);
    },
    [
      advanceCursorTo,
      commitIsBuffering,
      commitIsPlaying,
      commitQueue,
      flushCurrentPlayEvent,
      recentlyPlayed,
      registerEngineTrack,
      startTrackerSession,
    ],
  );

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

  const clearNativeBufferingWatchdog = useCallback(() => {
    if (nativeBufferingWatchdogRef.current === null) return;
    window.clearTimeout(nativeBufferingWatchdogRef.current);
    nativeBufferingWatchdogRef.current = null;
  }, []);

  const probeNativeBuffering = useCallback(async () => {
    const track = currentTrackRef.current;
    const probeId = nativeBufferingProbeIdRef.current + 1;
    nativeBufferingProbeIdRef.current = probeId;
    const streamUrl = track ? getStreamUrl(track) : "";
    const redactedUrl = redactDiagnosticUrl(streamUrl);

    let status: number | "network-error" | "timeout" | "no-track" = track
      ? "network-error"
      : "no-track";
    let detail = "";
    if (track && streamUrl) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(streamUrl, {
          method: "GET",
          headers: { Range: "bytes=0-0" },
          credentials: "include",
          cache: "no-store",
          signal: controller.signal,
        });
        response.body?.cancel().catch(() => {});
        status = response.status;
        detail =
          response.ok || response.status === 206
            ? "Range probe succeeded from WebView"
            : response.statusText;
      } catch (error) {
        status =
          error instanceof DOMException && error.name === "AbortError"
            ? "timeout"
            : "network-error";
        detail = error instanceof Error ? error.message : String(error);
      } finally {
        window.clearTimeout(timeout);
      }
    }

    if (probeId !== nativeBufferingProbeIdRef.current) return;
    persistNativePlaybackDiagnostic({
      type: "buffering-timeout",
      track: track
        ? { id: track.id, title: track.title, artist: track.artist }
        : null,
      streamUrl: redactedUrl,
      probeStatus: status,
      detail,
    });
    toast.error("Native playback is stuck buffering", {
      description: `Stream probe: ${status}${detail ? ` · ${detail}` : ""}`,
      duration: 9000,
    });
  }, [currentTrackRef]);

  const scheduleNativeBufferingWatchdog = useCallback(() => {
    clearNativeBufferingWatchdog();
    nativeBufferingWatchdogRef.current = window.setTimeout(() => {
      nativeBufferingWatchdogRef.current = null;
      void probeNativeBuffering();
    }, NATIVE_BUFFERING_WATCHDOG_MS);
  }, [clearNativeBufferingWatchdog, probeNativeBuffering]);

  const applyNativePosition = useCallback(
    (event: EnginePositionEvent) => {
      const positionSeconds = projectedNativePositionSeconds(
        event.positionMs,
        event.nativeTimeMs,
        event.isPlaying,
        event.durationMs,
      );
      const nativeDurationSeconds = nativeMsToSeconds(event.durationMs);
      const fallbackDurationSeconds = trackDurationSeconds(
        queueRef.current[event.index] ?? currentTrackRef.current,
      );
      commitCurrentTime(positionSeconds);
      if (nativeDurationSeconds > 0 || fallbackDurationSeconds > 0) {
        commitDuration(nativeDurationSeconds || fallbackDurationSeconds);
      }
      commitIsPlaying(event.isPlaying);
      if (event.isPlaying) {
        recordProgress(positionSeconds);
      }
    },
    [
      commitCurrentTime,
      commitDuration,
      commitIsPlaying,
      currentTrackRef,
      queueRef,
      recordProgress,
    ],
  );

  const applyNativeState = useCallback(
    (
      state: EngineState,
      options: { rotateIndexChange?: boolean; passiveLifecycle?: boolean } = {},
    ) => {
      const positionSeconds = projectedNativePositionSeconds(
        state.positionMs,
        state.nativeTimeMs,
        state.isPlaying,
        state.durationMs,
      );
      const nativeDurationSeconds = nativeMsToSeconds(state.durationMs);
      commitCurrentTime(positionSeconds);
      if (state.queueSize === 0) {
        commitDuration(0);
      }

      const queue = queueRef.current;
      if (state.index >= 0 && state.index < queue.length) {
        const previousIndex = currentIndexRef.current;
        const incomingTrack = queue[state.index];
        const durationSeconds =
          nativeDurationSeconds || trackDurationSeconds(incomingTrack);
        if (durationSeconds > 0) {
          commitDuration(durationSeconds);
        }
        if (state.index !== previousIndex) {
          const outgoingTrack = queue[previousIndex];
          if (options.rotateIndexChange) {
            const reason = nativeTransitionFlushReason(
              undefined,
              previousIndex,
              state.index,
              queue.length,
              repeatRef.current,
            );
            if (reason) {
              rotateTrackerSession(
                reason,
                outgoingTrack,
                incomingTrack,
                playSourceRef.current,
              );
            }
          } else if (state.isPlaying) {
            ensureTrackerSession(incomingTrack, playSourceRef.current);
          }
          commitCurrentIndex(state.index);
          rememberActiveTrack(incomingTrack);
        } else {
          rememberActiveTrack(incomingTrack);
          if (state.isPlaying) {
            ensureTrackerSession(incomingTrack, playSourceRef.current);
          }
        }
      }

      const isPassiveLifecycleBuffering =
        options.passiveLifecycle && state.playbackState === "buffering";
      commitIsPlaying(state.isPlaying);
      commitIsBuffering(
        isPassiveLifecycleBuffering
          ? false
          : state.playbackState === "buffering",
      );
      if (state.playbackState === "buffering" && !isPassiveLifecycleBuffering) {
        scheduleNativeBufferingWatchdog();
      } else {
        clearNativeBufferingWatchdog();
      }
      if (state.isPlaying) {
        recordProgress(positionSeconds);
      }
    },
    [
      clearNativeBufferingWatchdog,
      commitCurrentIndex,
      commitCurrentTime,
      commitDuration,
      commitIsBuffering,
      commitIsPlaying,
      currentIndexRef,
      ensureTrackerSession,
      playSourceRef,
      queueRef,
      recordProgress,
      rememberActiveTrack,
      repeatRef,
      rotateTrackerSession,
      scheduleNativeBufferingWatchdog,
    ],
  );

  const applyNativeTrackChange = useCallback(
    (event: EnginePositionEvent & { reason?: string }) => {
      const queue = queueRef.current;
      if (event.index < 0 || event.index >= queue.length) return;

      const previousIndex = currentIndexRef.current;
      const incomingTrack = queue[event.index];
      const outgoingTrack = queue[previousIndex];
      const positionSeconds = projectedNativePositionSeconds(
        event.positionMs,
        event.nativeTimeMs,
        event.isPlaying,
        event.durationMs,
      );
      const durationSeconds =
        nativeMsToSeconds(event.durationMs) ||
        trackDurationSeconds(incomingTrack);
      commitCurrentTime(positionSeconds);
      if (durationSeconds > 0) {
        commitDuration(durationSeconds);
      }

      if (event.index !== previousIndex) {
        const reason = nativeTransitionFlushReason(
          event.reason,
          previousIndex,
          event.index,
          queue.length,
          repeatRef.current,
        );
        if (reason) {
          rotateTrackerSession(
            reason,
            outgoingTrack,
            incomingTrack,
            playSourceRef.current,
          );
        } else {
          ensureTrackerSession(incomingTrack, playSourceRef.current);
        }
        commitCurrentIndex(event.index);
        rememberActiveTrack(incomingTrack);
      } else {
        rememberActiveTrack(incomingTrack);
        if (event.isPlaying) {
          ensureTrackerSession(incomingTrack, playSourceRef.current);
        }
      }

      commitIsPlaying(event.isPlaying);
      commitIsBuffering(false);
    },
    [
      commitCurrentIndex,
      commitCurrentTime,
      commitDuration,
      commitIsBuffering,
      commitIsPlaying,
      currentIndexRef,
      ensureTrackerSession,
      playSourceRef,
      queueRef,
      rememberActiveTrack,
      repeatRef,
      rotateTrackerSession,
    ],
  );

  const handleNativeEvent = useCallback(
    <K extends EngineEventName>(eventName: K, payload: EngineEventMap[K]) => {
      if (eventName === "positionChanged") {
        applyNativePosition(payload as EnginePositionEvent);
        return;
      }
      if (eventName === "playEventCheckpoint") {
        applyNativePosition(payload as EnginePositionEvent);
        return;
      }
      if (eventName === "stateChanged") {
        applyNativeState(payload as EngineState);
        return;
      }
      if (eventName === "trackChanged") {
        applyNativeTrackChange(
          payload as EnginePositionEvent & { reason?: string },
        );
        return;
      }
      if (eventName === "bufferingChanged") {
        const isNativeBuffering = (payload as { isBuffering: boolean })
          .isBuffering;
        commitIsBuffering(isNativeBuffering);
        if (isNativeBuffering) {
          scheduleNativeBufferingWatchdog();
        } else {
          clearNativeBufferingWatchdog();
        }
        return;
      }
      if (eventName === "nearQueueEnd") {
        continueInfinitePlayback();
        return;
      }
      if (eventName === "queueEnded") {
        const endedTrack = queueRef.current[currentIndexRef.current];
        clearNativeBufferingWatchdog();
        flushCurrentPlayEvent("completed", endedTrack);
        bufferingIntentRef.current = false;
        commitIsPlaying(false);
        commitIsBuffering(false);
        return;
      }
      if (eventName === "error") {
        const nativeError = payload as EngineEventMap["error"];
        const summary = nativePlaybackErrorMessage(nativeError);
        persistNativePlaybackDiagnostic({
          type: "error",
          ...nativeError,
          url: redactDiagnosticUrl(nativeError.url),
        });
        clearNativeBufferingWatchdog();
        console.error("[native-player] playback error:", payload);
        toast.error("Native playback failed", {
          description: summary,
          duration: 9000,
        });
        bufferingIntentRef.current = false;
        commitIsPlaying(false);
        commitIsBuffering(false);
        beginSoftInterruption("stream");
      }
    },
    [
      applyNativePosition,
      applyNativeState,
      applyNativeTrackChange,
      beginSoftInterruption,
      bufferingIntentRef,
      clearNativeBufferingWatchdog,
      commitIsPlaying,
      commitIsBuffering,
      continueInfinitePlayback,
      currentIndexRef,
      flushCurrentPlayEvent,
      queueRef,
      scheduleNativeBufferingWatchdog,
    ],
  );

  const reconcileNativePlayback = useCallback(
    (
      options: { rotateIndexChange?: boolean; passiveLifecycle?: boolean } = {},
    ) => {
      if (!shouldUseAndroidNativePlayer()) return;
      void androidNativeEngine
        .getState()
        .then((state) => {
          if (!state) return;
          applyNativeState(state, options);
        })
        .catch(() => {});
    },
    [applyNativeState],
  );

  useEffect(() => {
    const onPrefsChanged = (event: Event) => {
      const detail = (
        event as CustomEvent<{
          crossfadeSeconds?: number;
          smartCrossfadeEnabled?: boolean;
          infinitePlaybackEnabled?: boolean;
          playbackDeliveryPolicy?: PlaybackDeliveryPolicy;
          smartPlaylistSuggestionsEnabled?: boolean;
          smartPlaylistSuggestionsCadence?: number;
        }>
      ).detail;
      syncEffectiveCrossfade();
      if (typeof detail?.smartCrossfadeEnabled === "boolean") {
        setSmartCrossfadeEnabled(detail.smartCrossfadeEnabled);
      } else {
        setSmartCrossfadeEnabled(getSmartCrossfadePreference());
      }
      if (typeof detail?.infinitePlaybackEnabled === "boolean") {
        setInfinitePlaybackEnabled(detail.infinitePlaybackEnabled);
      } else {
        setInfinitePlaybackEnabled(getInfinitePlaybackPreference());
      }
      if (detail?.playbackDeliveryPolicy) {
        setPlaybackDeliveryPolicy(detail.playbackDeliveryPolicy);
      } else {
        setPlaybackDeliveryPolicy(getPlaybackDeliveryPolicyPreference());
      }
      if (typeof detail?.smartPlaylistSuggestionsEnabled === "boolean") {
        setSmartPlaylistSuggestionsEnabled(
          detail.smartPlaylistSuggestionsEnabled,
        );
      } else {
        setSmartPlaylistSuggestionsEnabled(
          getSmartPlaylistSuggestionsPreference(),
        );
      }
      if (typeof detail?.smartPlaylistSuggestionsCadence === "number") {
        setSmartPlaylistSuggestionsCadence(
          detail.smartPlaylistSuggestionsCadence,
        );
      } else {
        setSmartPlaylistSuggestionsCadence(
          getSmartPlaylistSuggestionsCadencePreference(),
        );
      }
    };

    window.addEventListener(
      PLAYER_PLAYBACK_PREFS_EVENT,
      onPrefsChanged as EventListener,
    );
    return () => {
      window.removeEventListener(
        PLAYER_PLAYBACK_PREFS_EVENT,
        onPrefsChanged as EventListener,
      );
    };
  }, [syncEffectiveCrossfade]);

  useEffect(() => {
    syncEffectiveCrossfade();
  }, [
    syncEffectiveCrossfade,
    queue,
    currentIndex,
    playSource,
    repeat,
    shuffle,
    smartCrossfadeEnabled,
  ]);

  useEffect(() => {
    if (!shouldUseAndroidNativePlayer()) return;
    let disposed = false;
    const removers: Array<() => void> = [];
    const addListeners = async () => {
      const positionRemove = await androidNativeEngine.on(
        "positionChanged",
        (event) => {
          if (disposed) return;
          applyNativePosition(event);
        },
      );
      removers.push(positionRemove);

      const checkpointRemove = await androidNativeEngine.on(
        "playEventCheckpoint",
        (event) => {
          if (disposed) return;
          applyNativePosition(event);
        },
      );
      removers.push(checkpointRemove);

      const stateRemove = await androidNativeEngine.on(
        "stateChanged",
        (event) => {
          if (disposed) return;
          applyNativeState(event);
        },
      );
      removers.push(stateRemove);

      const trackRemove = await androidNativeEngine.on(
        "trackChanged",
        (event) => {
          if (disposed) return;
          applyNativeTrackChange(event);
        },
      );
      removers.push(trackRemove);

      const bufferingRemove = await androidNativeEngine.on(
        "bufferingChanged",
        (event) => {
          if (disposed) return;
          commitIsBuffering(event.isBuffering);
        },
      );
      removers.push(bufferingRemove);

      const nearEndRemove = await androidNativeEngine.on("nearQueueEnd", () => {
        if (disposed) return;
        continueInfinitePlayback();
      });
      removers.push(nearEndRemove);

      const queueEndedRemove = await androidNativeEngine.on(
        "queueEnded",
        (event) => {
          if (disposed) return;
          handleNativeEvent("queueEnded", event);
        },
      );
      removers.push(queueEndedRemove);

      const errorRemove = await androidNativeEngine.on("error", (event) => {
        if (disposed) return;
        handleNativeEvent("error", event);
      });
      removers.push(errorRemove);
    };

    void addListeners().catch((error) => {
      console.error("[native-player] failed to attach listeners:", error);
    });

    void androidNativeEngine
      .drainEvents()
      .then((events) => {
        if (disposed) return;
        for (const event of events) {
          handleNativeEvent(event.event, event.payload);
        }
      })
      .catch(() => {});

    reconcileNativePlayback();
    const onNativeResume = () => {
      reconcileNativePlayback({
        rotateIndexChange: true,
        passiveLifecycle: true,
      });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        reconcileNativePlayback({
          rotateIndexChange: true,
          passiveLifecycle: true,
        });
      }
    };
    window.addEventListener("crate:app-resumed", onNativeResume);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      disposed = true;
      window.removeEventListener("crate:app-resumed", onNativeResume);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      for (const remove of removers) {
        remove();
      }
    };
  }, [
    applyNativePosition,
    applyNativeState,
    applyNativeTrackChange,
    commitIsBuffering,
    continueInfinitePlayback,
    handleNativeEvent,
    reconcileNativePlayback,
  ]);

  useEffect(() => {
    preparePlaybackDelivery(queue, currentIndex, playbackDeliveryPolicy);
  }, [currentIndex, playbackDeliveryPolicy, queue]);

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
  } = usePlayerQueueActions({
    queueRef,
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
    pullFromEngine,
    pushToEngine,
    advanceCursorTo,
    playbackDeliveryPolicy,
  });

  const clearQueueRef = useRef(clearQueue);
  useEffect(() => {
    clearQueueRef.current = clearQueue;
  }, [clearQueue]);

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
      clearNativeBufferingWatchdog();
      gpDestroyPlayer();
    };
  }, [clearNativeBufferingWatchdog]);

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
    }),
    [
      queue,
      currentIndex,
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
    ],
  );

  return (
    <PlayerActionsContext.Provider value={actionsValue}>
      <PlayerStateContext.Provider value={stateValue}>
        <PlayerProgressContext.Provider value={progressValue}>
          {children}
          {playbackNeedsUserGesture && currentTrack ? (
            <div className="pointer-events-none fixed inset-x-4 bottom-[calc(var(--listen-player-bottom-offset,5.5rem)+env(safe-area-inset-bottom))] z-[1600] flex justify-center sm:bottom-28">
              <button
                type="button"
                className="pointer-events-auto rounded-full border border-cyan-400/30 bg-slate-950/95 px-4 py-3 text-sm font-semibold text-white shadow-2xl shadow-cyan-950/40 backdrop-blur"
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
