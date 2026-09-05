import { useCallback, useEffect, useRef } from "react";

import type { PlaySource, Track } from "@/contexts/player-types";
import { clampIndex } from "@/contexts/player-queue-helpers";
import { toStartupEngineTracks } from "@/contexts/player-engine-adapter";
import { subscribeNativePlayerEvents } from "@/contexts/subscribe-native-player-events";
import { getStreamUrl } from "@/contexts/player-utils";
import { refreshAuthToken } from "@/lib/api";
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
import { createQueueRevision } from "@/lib/playback-engine";
import { recordDevLog } from "@/lib/dev-logs";
import { toast } from "sonner";

const NATIVE_BUFFERING_WATCHDOG_MS = 12000;
const NATIVE_PLAYBACK_DIAGNOSTIC_KEY = "listen-native-playback-diagnostic:v1";

type ValueRef<T> = { readonly current: T };
type MutableValueRef<T> = { current: T };

type NativePlaybackRuntimeOptions = {
  beginSoftInterruption: (reason: "stream") => void;
  bufferingIntentRef: MutableValueRef<boolean>;
  commitCurrentIndex: (index: number) => void;
  commitCurrentTime: (time: number) => void;
  commitDuration: (duration: number) => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  currentIndexRef: ValueRef<number>;
  currentTimeRef: ValueRef<number>;
  currentTrackRef: ValueRef<Track | undefined>;
  effectiveCrossfadeMsRef: ValueRef<number>;
  ensureTrackerSession: (
    track: Track | undefined,
    playSource: PlaySource | null,
  ) => void;
  flushCurrentPlayEvent: (
    reason: "completed" | "skipped",
    track?: Track,
  ) => void;
  lastNonZeroVolumeRef: ValueRef<number>;
  playSourceRef: ValueRef<PlaySource | null>;
  queueRef: ValueRef<Track[]>;
  recordProgress: (positionSeconds: number) => void;
  rememberActiveTrack: (track: Track | undefined) => void;
  repeatRef: ValueRef<"off" | "one" | "all">;
  rotateTrackerSession: (
    reason: "completed" | "skipped",
    outgoing: Track | undefined,
    incoming: Track | undefined,
    playSource: PlaySource | null,
  ) => void;
};

export function nativeTransitionFlushReason(
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

export function projectedNativePositionSeconds(
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

export function useNativePlaybackRuntime({
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
}: NativePlaybackRuntimeOptions) {
  const nativeBufferingWatchdogRef = useRef<number | null>(null);
  const nativeBufferingProbeIdRef = useRef(0);
  const nativeAuthRetryKeyRef = useRef<string | null>(null);
  const nativeBufferingRecoveryKeyRef = useRef<string | null>(null);

  const clearNativeBufferingWatchdog = useCallback(() => {
    if (nativeBufferingWatchdogRef.current === null) return;
    window.clearTimeout(nativeBufferingWatchdogRef.current);
    nativeBufferingWatchdogRef.current = null;
  }, []);

  const recoverNativeBuffering = useCallback(
    async (options: { forceRefresh: boolean; probeStatus: string }) => {
      if (!shouldUseAndroidNativePlayer()) return false;

      const queueSnapshot = queueRef.current;
      if (queueSnapshot.length === 0) return false;

      const index = clampIndex(currentIndexRef.current, queueSnapshot.length);
      const targetTrack = queueSnapshot[index];
      const positionMs = Math.max(0, Math.round(currentTimeRef.current * 1000));
      const retryKey = [
        targetTrack?.id || index,
        Math.floor(positionMs / 10_000),
        options.probeStatus,
      ].join(":");
      if (nativeBufferingRecoveryKeyRef.current === retryKey) return false;
      nativeBufferingRecoveryKeyRef.current = retryKey;

      if (options.forceRefresh && !(await refreshAuthToken())) {
        return false;
      }

      const engineTracks = await toStartupEngineTracks(
        queueSnapshot,
        index,
        undefined,
        { target: "android-native" },
      );
      await androidNativeEngine.loadQueue({
        revision: createQueueRevision(),
        tracks: engineTracks,
        currentIndex: index,
        positionMs,
        autoplay: true,
        repeat: repeatRef.current,
        crossfadeMs: effectiveCrossfadeMsRef.current,
        volume: lastNonZeroVolumeRef.current,
      });
      return true;
    },
    [
      currentIndexRef,
      currentTimeRef,
      effectiveCrossfadeMsRef,
      lastNonZeroVolumeRef,
      queueRef,
      repeatRef,
    ],
  );

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
    const isNativeLocalUrl =
      streamUrl.startsWith("file:") ||
      streamUrl.startsWith("capacitor:") ||
      streamUrl.startsWith("content:");

    if (track && streamUrl && isNativeLocalUrl) {
      status = 206;
      detail = "Native local media URL; skipping WebView range probe";
    } else if (track && streamUrl) {
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
    const canRecover =
      status === 200 || status === 206 || status === 401 || isNativeLocalUrl;
    if (canRecover) {
      try {
        const recovered = await recoverNativeBuffering({
          forceRefresh: status === 401,
          probeStatus: String(status),
        });
        if (recovered) {
          recordDevLog(
            "native-player",
            "recovered stuck native buffering",
            {
              track: track?.title,
              artist: track?.artist,
              probeStatus: status,
              url: redactedUrl,
            },
            "warn",
          );
          return;
        }
      } catch (error) {
        persistNativePlaybackDiagnostic({
          type: "buffering-recovery-failed",
          track: track
            ? { id: track.id, title: track.title, artist: track.artist }
            : null,
          streamUrl: redactedUrl,
          probeStatus: status,
          detail,
          recoveryError: error instanceof Error ? error.message : String(error),
        });
      }
    }
    toast.error("Native playback is stuck buffering", {
      description: `Stream probe: ${status}${detail ? ` · ${detail}` : ""}`,
      duration: 9000,
    });
  }, [currentTrackRef, recoverNativeBuffering]);

  const scheduleNativeBufferingWatchdog = useCallback(() => {
    clearNativeBufferingWatchdog();
    nativeBufferingWatchdogRef.current = window.setTimeout(() => {
      nativeBufferingWatchdogRef.current = null;
      void probeNativeBuffering();
    }, NATIVE_BUFFERING_WATCHDOG_MS);
  }, [clearNativeBufferingWatchdog, probeNativeBuffering]);

  const retryNativePlaybackAfterAuthError = useCallback(
    (nativeError: EngineEventMap["error"]): boolean => {
      if (nativeError.httpStatus !== 401) return false;
      if (!shouldUseAndroidNativePlayer()) return false;

      const queueSnapshot = queueRef.current;
      if (queueSnapshot.length === 0) return false;

      const nativeIndex =
        typeof nativeError.index === "number" &&
        Number.isFinite(nativeError.index)
          ? nativeError.index
          : currentIndexRef.current;
      const index = clampIndex(nativeIndex, queueSnapshot.length);
      const targetTrack = queueSnapshot[index];
      const positionMs = Math.max(0, Math.round(currentTimeRef.current * 1000));
      const retryKey = [
        nativeError.revision,
        nativeError.trackId || targetTrack?.id || index,
        Math.floor(positionMs / 10_000),
      ].join(":");
      if (nativeAuthRetryKeyRef.current === retryKey) return false;
      nativeAuthRetryKeyRef.current = retryKey;

      bufferingIntentRef.current = true;
      commitIsBuffering(true);
      commitIsPlaying(true);

      void (async () => {
        if (!(await refreshAuthToken())) {
          throw new Error("Could not refresh the native playback token");
        }
        const engineTracks = await toStartupEngineTracks(
          queueSnapshot,
          index,
          undefined,
          { target: "android-native" },
        );
        await androidNativeEngine.loadQueue({
          revision: createQueueRevision(),
          tracks: engineTracks,
          currentIndex: index,
          positionMs,
          autoplay: true,
          repeat: repeatRef.current,
          crossfadeMs: effectiveCrossfadeMsRef.current,
          volume: lastNonZeroVolumeRef.current,
        });
      })().catch((error) => {
        const summary = nativePlaybackErrorMessage(nativeError);
        console.error("[native-player] failed to recover auth error:", error);
        persistNativePlaybackDiagnostic({
          type: "auth-retry-failed",
          ...nativeError,
          url: redactDiagnosticUrl(nativeError.url),
          retryError: error instanceof Error ? error.message : String(error),
        });
        toast.error("Native playback failed", {
          description: summary,
          duration: 9000,
        });
        bufferingIntentRef.current = false;
        commitIsPlaying(false);
        commitIsBuffering(false);
        beginSoftInterruption("stream");
      });

      return true;
    },
    [
      beginSoftInterruption,
      bufferingIntentRef,
      commitIsBuffering,
      commitIsPlaying,
      currentIndexRef,
      currentTimeRef,
      effectiveCrossfadeMsRef,
      lastNonZeroVolumeRef,
      queueRef,
      repeatRef,
    ],
  );

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
        if (state.playbackState !== "buffering") {
          nativeBufferingRecoveryKeyRef.current = null;
        }
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
        // Native near-end is only a signal that the queue is getting short.
        // The regular playback-intelligence effect handles prefetching without
        // moving the cursor; advancing here skips the rest of the album/playlist.
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
      if (eventName === "resumeAuthorizationRequired") {
        void recoverNativeBuffering({
          forceRefresh: false,
          probeStatus: "resume-authorization",
        }).catch((error) => {
          console.error(
            "[native-player] failed to authorize restored playback:",
            error,
          );
          toast.error("Open Crate to resume playback", {
            description: "The saved queue needs fresh server authorization.",
          });
        });
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
        if (retryNativePlaybackAfterAuthError(nativeError)) {
          return;
        }
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
      commitIsBuffering,
      commitIsPlaying,
      currentIndexRef,
      flushCurrentPlayEvent,
      queueRef,
      recoverNativeBuffering,
      retryNativePlaybackAfterAuthError,
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
    if (!shouldUseAndroidNativePlayer()) return;
    let disposed = false;
    const subscription = subscribeNativePlayerEvents(androidNativeEngine, {
      positionChanged: (event) => {
        if (disposed) return;
        applyNativePosition(event);
      },
      playEventCheckpoint: (event) => {
        if (disposed) return;
        applyNativePosition(event);
      },
      stateChanged: (event) => {
        if (disposed) return;
        applyNativeState(event);
      },
      trackChanged: (event) => {
        if (disposed) return;
        applyNativeTrackChange(event);
      },
      bufferingChanged: (event) => {
        if (disposed) return;
        handleNativeEvent("bufferingChanged", event);
      },
      nearQueueEnd: (event) => {
        if (disposed) return;
        handleNativeEvent("nearQueueEnd", event);
      },
      queueEnded: (event) => {
        if (disposed) return;
        handleNativeEvent("queueEnded", event);
      },
      resumeAuthorizationRequired: (event) => {
        if (disposed) return;
        handleNativeEvent("resumeAuthorizationRequired", event);
      },
      error: (event) => {
        if (disposed) return;
        handleNativeEvent("error", event);
      },
    });

    void subscription.ready.catch((error) => {
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
      clearNativeBufferingWatchdog();
      subscription.dispose();
    };
  }, [
    applyNativePosition,
    applyNativeState,
    applyNativeTrackChange,
    clearNativeBufferingWatchdog,
    handleNativeEvent,
    reconcileNativePlayback,
  ]);
}
