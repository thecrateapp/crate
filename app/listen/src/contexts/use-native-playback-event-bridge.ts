import { useCallback, useEffect } from "react";

import type { Track } from "@/contexts/player-types";
import { subscribeNativePlayerEvents } from "@/contexts/subscribe-native-player-events";
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
  nativePlaybackErrorMessage,
  persistNativePlaybackDiagnostic,
  redactDiagnosticUrl,
} from "@/contexts/use-native-buffering-recovery";
import { recordDevLog } from "@/lib/dev-logs";
import { toast } from "sonner";

type ValueRef<T> = { readonly current: T };
type MutableValueRef<T> = { current: T };
type NativeTimedPayload = { nativeTimeMs?: number };

export function shouldHandleNativeSideEffectEvent(
  payload: NativeTimedPayload,
  isNativeEventStale: (nativeTimeMs: number | undefined) => boolean,
): boolean {
  return !isNativeEventStale(payload.nativeTimeMs);
}

// The most common trigger for resumeAuthorizationRequired is Android
// killing the whole process (not just the service) while a foreground
// media notification is alive — the native side restores a checkpoint
// with placeholder URIs and asks JS to re-supply the real queue as soon
// as it attaches an event sink, which happens right on app relaunch,
// often before the app's own persisted queue has been rehydrated into
// React state. A single immediate attempt loses that race silently
// (recoverNativeBuffering resolves to `false`, not a thrown error, so
// nothing surfaced it): retry a few times as the queue catches up
// before giving up and telling the user to open the app.
const RESUME_AUTHORIZATION_RETRY_DELAYS_MS = [0, 500, 1500, 3000];

export async function recoverNativeResumeAuthorizationWithRetry(
  recoverNativeBuffering: (options: {
    forceRefresh: boolean;
    probeStatus: string;
    autoplay?: boolean;
  }) => Promise<boolean>,
  autoplay: boolean,
): Promise<boolean> {
  for (const delay of RESUME_AUTHORIZATION_RETRY_DELAYS_MS) {
    if (delay > 0) {
      await new Promise((resolve) => window.setTimeout(resolve, delay));
    }
    const recovered = await recoverNativeBuffering({
      forceRefresh: false,
      probeStatus: "resume-authorization",
      autoplay,
    });
    if (recovered) return true;
  }
  return false;
}

type PlaybackStateOptions = {
  rotateIndexChange?: boolean;
  passiveLifecycle?: boolean;
};

export interface UseNativePlaybackEventBridgeParams {
  applyNativePosition: (event: EnginePositionEvent) => void;
  applyNativeState: (
    state: EngineState,
    options?: PlaybackStateOptions,
  ) => void;
  applyNativeTrackChange: (
    event: EnginePositionEvent & { reason?: string },
  ) => void;
  beginSoftInterruption: (reason: "stream") => void;
  bufferingIntentRef: MutableValueRef<boolean>;
  clearNativeBufferingWatchdog: () => void;
  commitIsBuffering: (isBuffering: boolean) => void;
  commitIsPlaying: (isPlaying: boolean) => void;
  currentIndexRef: ValueRef<number>;
  flushCurrentPlayEvent: (
    reason: "completed" | "skipped",
    track?: Track,
  ) => void;
  isNativeEventStale: (nativeTimeMs: number | undefined) => boolean;
  queueRef: ValueRef<Track[]>;
  recoverNativeBuffering: (options: {
    forceRefresh: boolean;
    probeStatus: string;
  }) => Promise<boolean>;
  retryNativePlaybackAfterAuthError: (
    nativeError: EngineEventMap["error"],
  ) => boolean;
  scheduleNativeBufferingWatchdog: () => void;
}

export function useNativePlaybackEventBridge({
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
  isNativeEventStale,
  queueRef,
  recoverNativeBuffering,
  retryNativePlaybackAfterAuthError,
  scheduleNativeBufferingWatchdog,
}: UseNativePlaybackEventBridgeParams) {
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
      if (
        !shouldHandleNativeSideEffectEvent(
          payload as NativeTimedPayload,
          isNativeEventStale,
        )
      ) {
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
        const resumeEvent =
          payload as EngineEventMap["resumeAuthorizationRequired"];
        void recoverNativeResumeAuthorizationWithRetry(
          recoverNativeBuffering,
          Boolean(resumeEvent.playWhenReady),
        )
          .then((recovered) => {
            if (recovered) return;
            toast.error("Open Crate to resume playback", {
              description: "The saved queue needs fresh server authorization.",
            });
          })
          .catch((error) => {
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
      isNativeEventStale,
      queueRef,
      recoverNativeBuffering,
      retryNativePlaybackAfterAuthError,
      scheduleNativeBufferingWatchdog,
    ],
  );

  const reconcileNativePlayback = useCallback(
    (options: PlaybackStateOptions = {}) => {
      if (!shouldUseAndroidNativePlayer()) return;
      void androidNativeEngine.getState().then((state) => {
        // getState() itself swallows native-bridge failures and resolves
        // null rather than rejecting — nothing else surfaces that, so
        // reconciliation would otherwise fail silently on every foreground.
        if (!state) {
          recordDevLog(
            "native-player",
            "foreground reconciliation failed to read native state",
            {},
            "warn",
          );
          return;
        }
        applyNativeState(state, options);
      });
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

    // Listeners attach one event at a time (subscription.ready), each a
    // native round trip — draining or reconciling before that finishes
    // could ask native to flush events into a listener that isn't wired up
    // yet and silently lose them. Reconciling (getState) only after the
    // drain also ensures the freshest snapshot is applied last, instead of
    // racing a stale buffered event for who gets applied second.
    void subscription.ready
      .then(() => {
        if (disposed) return;
        return androidNativeEngine
          .drainEvents()
          .then((events) => {
            if (disposed) return;
            for (const event of events) {
              handleNativeEvent(event.event, event.payload);
            }
          })
          .catch(() => {});
      })
      .then(() => {
        if (disposed) return;
        reconcileNativePlayback();
      })
      .catch((error) => {
        console.error("[native-player] failed to attach listeners:", error);
      });

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
